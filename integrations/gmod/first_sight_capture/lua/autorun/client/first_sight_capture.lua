-- First-Sight bounded capture prototype. Engine execution NOT yet verified.
-- Local single-player only. Never starts recording on load.
local state, busy, target = nil, false, nil
local WIDTH, HEIGHT = 640, 480
local BYTE_CAP = 128 * 1024 * 1024
local imageCap = 2 * 1024 * 1024
local fov = CreateClientConVar("fs_capture_fov", "90", false, false, "RenderView FOV", 40, 120)
local scale = CreateClientConVar("fs_capture_m_per_unit", "0.0254", false, false, "Uncalibrated metres per Source unit", 0.001, 1)
-- Source yaw +90 is physically LEFT, unlike UE's +90 (right).
local cameras = {
    {name = "front", yaw = 0, offset = Vector(0, 0, 0)},
    {name = "left", yaw = 90, offset = Vector(0, 0, 0)},
    {name = "right", yaw = -90, offset = Vector(0, 0, 0)}
}

local function vec(v) return {v.x, v.y, v.z} end
local function pose(pos, ang, unit)
    -- Right-handed FLU basis, columns = forward, left, up in world coordinates.
    local forward, left, up = ang:Forward(), -ang:Right(), ang:Up()
    return {position_m = vec(pos * unit), source_position = vec(pos),
        source_angles_pyr_deg = {ang.p, ang.y, ang.r},
        rotation_world_from_flu = {
            {forward.x, left.x, up.x}, {forward.y, left.y, up.y}, {forward.z, left.z, up.z}
        }}
end

local function writeBytes(path, bytes)
    if not state or state.bytes + #bytes > BYTE_CAP then error("128MiB episode budget exceeded") end
    file.Write(path, bytes)
    if file.Size(path, "DATA") ~= #bytes then error("Write verification failed: " .. path) end
    state.bytes = state.bytes + #bytes
end

local function appendJSON(name, row)
    local raw = assert(util.TableToJSON(row)) .. "\n"
    if state.bytes + #raw > BYTE_CAP then error("Episode byte budget exceeded") end
    -- GMod's DATA extension allowlist does not permit bare .jsonl writes.
    local path = state.root .. "/" .. name .. ".txt"
    local before = math.max(file.Size(path, "DATA"), 0)
    file.Append(path, raw)
    if file.Size(path, "DATA") ~= before + #raw then error("Append verification failed: " .. path) end
    state.bytes = state.bytes + #raw
end

local function stop(reason)
    if not state then return end
    local old = state
    local summary = {reason = reason, samples = old.count, accounted_bytes = old.bytes,
        elapsed_wall_s = SysTime() - old.started, runtime_acceptance_passed = false}
    -- Reserved small final receipt; no overwrite of image/sample evidence.
    file.Write(old.root .. "/summary.json", util.TableToJSON(summary, true))
    print("[First-Sight] stopped: " .. reason .. " | " .. old.root)
    state = nil
end

local function begin(count, motion)
    if state or busy then print("[First-Sight] already recording") return end
    if not game.SinglePlayer() then print("[First-Sight] single-player only") return end
    if not IsValid(LocalPlayer()) then print("[First-Sight] load a local map first") return end
    -- Fixed power-of-two backing texture, explicit 640x480 viewport/capture.
    target = target or GetRenderTarget("first_sight_capture_v1_1024", 1024, 1024)
    if target:Width() < WIDTH or target:Height() < HEIGHT then error("Render target too small") end
    local root = "first_sight/" .. os.date("%Y%m%d_%H%M%S") .. "_" .. FrameNumber()
    if file.IsDir(root, "DATA") then error("Episode already exists; refusing overwrite") end
    file.CreateDir(root)
    for _, c in ipairs(cameras) do file.CreateDir(root .. "/cameras/" .. c.name) end
    state = {root = root, count = 0, maxCount = count, bytes = 0, started = SysTime(), startedSim = CurTime(),
        nextSim = CurTime(), lastPoseFrame = -1, unit = scale:GetFloat(), fov = fov:GetFloat(),
        motion = motion == true, initialYaw = LocalPlayer():EyeAngles().y,
        interval = motion and 0.2 or 2, format = motion and "jpeg" or "png"}
    local rig = {}
    for _, c in ipairs(cameras) do
        rig[#rig + 1] = {name = c.name, source_local_yaw_deg = c.yaw, offset_flu_m = vec(c.offset * state.unit)}
    end
    writeBytes(root .. "/metadata.json", util.TableToJSON({schema = "first-sight-gmod-pilot-v1",
        map = game.GetMap(), map_asset_hash_verified = false, game_version = VERSIONSTR,
        width = WIDTH, height = HEIGHT, render_view_fov = state.fov, intrinsics_calibrated = false,
        interval_sim_s = state.interval, max_samples = count, max_wall_s = 65, byte_cap = BYTE_CAP,
        capture_format = state.format, scripted_walk = state.motion, duration_sim_s = state.motion and 60 or 0,
        source_axes = "Source world XYZ; native Angle(pitch,yaw,roll) in degrees",
        pose_basis = "right-handed FLU: +X forward, +Y left, +Z up; matrix columns in world",
        metres_per_source_unit = state.unit, metric_scale_calibrated = false,
        head_definition = "LocalPlayer EyePos/EyeAngles, NOT anatomical skull bone or rendered camera cache",
        cameras = rig, same_state_strategy = "sequential RenderView calls in one PostRender callback",
        synchronized_views_verified = false, gold_only = true, world_persistence_verified = false}, true))
    print("[First-Sight] recording " .. count .. " sample(s): garrysmod/data/" .. root)
end

concommand.Add("fs_capture_static", function() begin(1) end)
concommand.Add("fs_capture_start", function() begin(30) end)
concommand.Add("fs_capture_stop", function() stop("user-stop") end)
-- Explicit command for a single local integration smoke test. Never runs on load.
concommand.Add("fs_capture_smoke", function()
    if not game.SinglePlayer() then return end
    gui.HideGameUI()
    timer.Simple(3, function() begin(1) end)
end)
-- Optional one-shot request written by the local test harness BEFORE launch.
-- Expired/unrecognized requests do nothing. No recording without this file or a command.
hook.Add("InitPostEntity", "FirstSightExplicitSmokeRequest", function()
    if not game.SinglePlayer() then return end
    local name = "first_sight_smoke_request.json"
    local raw = file.Read(name, "DATA")
    if not raw then return end
    local request = util.JSONToTable(raw)
    if not request or (request.mode ~= "static" and request.mode ~= "motion-video") or type(request.created_unix_s) ~= "number" then return end
    local age = os.time() - request.created_unix_s
    if age < 0 or age > 120 then return end
    file.Delete(name) -- only the explicitly supplied one-shot control file, never samples
    gui.HideGameUI()
    timer.Simple(3, function() begin(request.mode == "motion-video" and 301 or 1, request.mode == "motion-video") end)
end)

-- Deterministic normal walking/turning through CUserCmd. No OS input or teleports.
hook.Add("CreateMove", "FirstSightScriptedWalk", function(cmd)
    if not state or not state.motion then return end
    local elapsed = CurTime() - state.startedSim
    local segment = math.floor(elapsed / 15)
    local phase = elapsed % 15
    local turn = math.Clamp((phase - 12) / 3, 0, 1) * 90
    cmd:ClearButtons()
    cmd:ClearMovement()
    cmd:SetViewAngles(Angle(0, state.initialYaw + segment * 90 + turn, 0))
    if phase < 12 and elapsed < 60 then cmd:SetForwardMove(60) end
end)

hook.Add("Think", "FirstSightPosePilot", function()
    if not state or busy then return end
    if SysTime() - state.started > 65 then stop("wall-time-limit") return end
    if state.motion and CurTime() - state.startedSim >= 60 then stop("duration-limit") return end
    local ply = LocalPlayer()
    if not IsValid(ply) then stop("player-unavailable") return end
    local frame = FrameNumber()
    if frame == state.lastPoseFrame or (state.lastPoseSim and CurTime() <= state.lastPoseSim) then return end
    state.lastPoseFrame = frame
    state.lastPoseSim = CurTime()
    local ok, err = pcall(function()
        appendJSON("head_trajectory.jsonl", {frame = frame, tick = engine.TickCount(),
            sim_time_s = CurTime(), wall_time_s = SysTime(),
            sampling = "client Think/render dependent, not native high-rate IMU",
            head = pose(ply:EyePos(), ply:EyeAngles(), state.unit),
            player_velocity_m_s = vec(ply:GetVelocity() * state.unit)})
    end)
    if not ok then stop(tostring(err)) end
end)

hook.Add("PostRender", "FirstSightThreeCameraPilot", function()
    if not state or busy or CurTime() < state.nextSim then return end
    if gui.IsGameUIVisible() then return end
    local ply = LocalPlayer()
    if not IsValid(ply) then stop("player-unavailable") return end
    busy = true -- RenderView may reenter render hooks.
    local pushed = false
    local ok, err = xpcall(function()
        local frame, tick, sim = FrameNumber(), engine.TickCount(), CurTime()
        local pos, ang = ply:EyePos(), ply:EyeAngles()
        local id = state.count + 1
        local row = {sample_id = id, frame = frame, tick = tick, sim_time_s = sim,
            wall_time_s = SysTime(), head = pose(pos, ang, state.unit), cameras = {},
            synchronized_views_verified = false}
        local pending = {}
        for _, c in ipairs(cameras) do
            local cameraPos, cameraAng = LocalToWorld(c.offset, Angle(0, c.yaw, 0), pos, ang)
            render.PushRenderTarget(target, 0, 0, WIDTH, HEIGHT)
            pushed = true
            render.Clear(0, 0, 0, 255, true, true)
            local before = {frame = FrameNumber(), tick = engine.TickCount(), sim_time_s = CurTime(), wall_time_s = SysTime()}
            render.RenderView({origin = cameraPos, angles = cameraAng, x = 0, y = 0,
                w = WIDTH, h = HEIGHT, aspect = WIDTH / HEIGHT, fov = state.fov,
                drawhud = false, drawviewmodel = false, drawviewer = false,
                drawmonitors = false, dopostprocess = false, bloomtone = false})
            local bytes = render.Capture({format = state.format, quality = 80, x = 0, y = 0, w = WIDTH, h = HEIGHT, alpha = false})
            render.PopRenderTarget()
            pushed = false
            if not bytes or #bytes == 0 or #bytes > imageCap then error("Invalid/oversize capture " .. c.name) end
            local path = string.format("cameras/%s/%06d.%s", c.name, id, state.format == "jpeg" and "jpg" or "png")
            pending[#pending + 1] = {path = path, bytes = bytes}
            row.cameras[c.name] = {path = path, pose = pose(cameraPos, cameraAng, state.unit),
                before = before, after = {frame = FrameNumber(), tick = engine.TickCount(), sim_time_s = CurTime(), wall_time_s = SysTime()},
                bytes = #bytes, crc = util.CRC(bytes)}
        end
        row.frame_after, row.tick_after, row.sim_time_after_s = FrameNumber(), engine.TickCount(), CurTime()
        row.same_frame_tick_time = frame == row.frame_after and tick == row.tick_after and sim == row.sim_time_after_s
        -- This check is evidence of a callback boundary, NOT proof of animation/material synchronization.
        if not row.same_frame_tick_time then error("Simulation advanced during capture") end
        local total = 0
        for _, p in ipairs(pending) do total = total + #p.bytes end
        if state.bytes + total + 32768 > BYTE_CAP then error("Insufficient episode byte budget") end
        for _, p in ipairs(pending) do writeBytes(state.root .. "/" .. p.path, p.bytes) end
        writeBytes(state.root .. string.format("/camera_pose_%06d.json", id), util.TableToJSON(row, true))
        appendJSON("trajectory.jsonl", row) -- committed sample only after all images are written
        state.count = id
        state.nextSim = sim + state.interval -- no burst catch-up or invented missing samples
    end, debug.traceback)
    if pushed then render.PopRenderTarget() end
    busy = false
    if not ok then stop(tostring(err)) return end
    if state and state.count >= state.maxCount then stop("sample-limit") end
end)

hook.Add("ShutDown", "FirstSightCaptureStop", function() stop("game-shutdown") end)
