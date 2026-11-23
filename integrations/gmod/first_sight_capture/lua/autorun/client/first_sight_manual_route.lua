-- Opt-in, one-shot manual survey. No movement commands or OS input.
local active, previousButtons = nil, nil
local ARM = "first_sight/manual_route_armed.json"
local function vector(v) return {v.x, v.y, v.z} end
local function finish(reason)
    if not active then return end
    file.Write(active.root .. "/summary.json", util.TableToJSON({reason=reason,
        samples=active.samples, bytes=active.bytes, elapsed_wall_s=SysTime()-active.started,
        images_recorded=false, complete_navigation_map=false}, true))
    print("[First-Sight] manual route stopped: " .. reason .. " | " .. active.root)
    active = nil
end
local function append(name, row)
    local raw = util.TableToJSON(row) .. "\n"
    if active.bytes + #raw > 32*1024*1024 then finish("32MiB-limit") return end
    local path = active.root .. "/" .. name .. ".jsonl.txt"
    local before = math.max(0, file.Size(path, "DATA"))
    file.Append(path, raw)
    if file.Size(path, "DATA") ~= before + #raw then finish("write-failed") return end
    active.bytes = active.bytes + #raw
end
local function entityRow(ent)
    local a = ent:GetAngles()
    return {session_entity_index=ent:EntIndex(), map_creation_id=ent:MapCreationID(),
        class=ent:GetClass(), model=ent:GetModel(), position_source=vector(ent:GetPos()),
        angles_pyr_deg={a.p,a.y,a.r}, bounds_min_local=vector(ent:OBBMins()),
        bounds_max_local=vector(ent:OBBMaxs())}
end
local function start()
    if active or not game.SinglePlayer() or game.GetMap() ~= "rp_unioncity_day" then return end
    if not IsValid(LocalPlayer()) then return end
    local root = "first_sight/manual_route_" .. os.date("%Y%m%d_%H%M%S") .. "_" .. FrameNumber()
    if file.IsDir(root,"DATA") then return end
    file.CreateDir(root)
    active = {root=root,started=SysTime(),nextSample=0,samples=0,bytes=0}
    previousButtons = nil
    file.Write(root .. "/metadata.json",util.TableToJSON({schema="first-sight-manual-route-v1",
        map=game.GetMap(), source_units="Source units; not calibrated metres", interval_s=.1,
        max_wall_s=1200, byte_cap=32*1024*1024, images_recorded=false,
        entity_inventory="client-visible entities only; not complete geometry or navigation",
        controls_modified=false, gold_only=true},true))
    for _,ent in ipairs(ents.GetAll()) do
        if not active then break end
        if IsValid(ent) then append("entities",entityRow(ent)) end
    end
    print("[First-Sight] MANUAL ROUTE RECORDING (20 min max): " .. root)
    print("[First-Sight] Stop: fs_route_stop | mark location: fs_route_mark label")
end
concommand.Add("fs_route_stop",function() finish("user-stop") end)
concommand.Add("fs_route_mark",function(_,_,args)
    if active then append("markers",{time_s=CurTime(),label=string.sub(table.concat(args," "),1,200),
        position_source=vector(LocalPlayer():GetPos())}) end
end)
hook.Add("InitPostEntity","FirstSightManualRouteAuto",function()
    if not game.SinglePlayer() or game.GetMap() ~= "rp_unioncity_day" then return end
    local raw=file.Read(ARM,"DATA")
    local config=raw and util.JSONToTable(raw)
    if not config or config.schema ~= "first-sight-manual-route-arm-v1" then return end
    file.Delete(ARM) -- one shot: future sessions require explicit rearming
    RunConsoleCommand("fs_cursor_free","0")
    RunConsoleCommand("cl_mouseenable","1")
    gui.EnableScreenClicker(false)
    timer.Simple(3,start)
end)
hook.Add("CreateMove","FirstSightManualRouteObserve",function(cmd)
    if not active then return end
    local buttons=cmd:GetButtons()
    if buttons ~= previousButtons then
        local ply=LocalPlayer()
        if not IsValid(ply) then return end
        local trace=ply:GetEyeTrace()
        append("input_changes",{time_s=CurTime(),buttons=buttons,
            forward_move=cmd:GetForwardMove(),side_move=cmd:GetSideMove(),
            target=IsValid(trace.Entity) and entityRow(trace.Entity) or nil,
            hit_position_source=vector(trace.HitPos), interaction_success_verified=false})
        previousButtons=buttons
    end
end)
hook.Add("Think","FirstSightManualRouteSample",function()
    if not active then return end
    if SysTime()-active.started >= 1200 then finish("20min-limit") return end
    if file.Exists(active.root .. "/STOP","DATA") then finish("stop-file") return end
    if SysTime() < active.nextSample then return end
    active.nextSample=SysTime()+.1
    local ply=LocalPlayer()
    if not IsValid(ply) then finish("player-unavailable") return end
    local a=ply:EyeAngles()
    append("trajectory",{time_s=CurTime(),wall_elapsed_s=SysTime()-active.started,
        position_source=vector(ply:GetPos()),eye_position_source=vector(ply:EyePos()),
        eye_angles_pyr_deg={a.p,a.y,a.r},velocity_source=vector(ply:GetVelocity()),
        on_ground=ply:OnGround(),move_type=ply:GetMoveType()})
    if active then active.samples=active.samples+1 end
end)
hook.Add("ShutDown","FirstSightManualRouteShutdown",function() finish("game-shutdown") end)
