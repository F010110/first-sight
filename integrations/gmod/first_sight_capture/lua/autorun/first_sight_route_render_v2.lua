-- Explicit bounded pose-render job. Elevator reconstruction is inferred, NOT original footage.
local REQUEST = "first_sight/route_render_v2_request.json"
if SERVER then
    AddCSLuaFile()
    util.AddNetworkString("FirstSightRouteV2Step")
    util.AddNetworkString("FirstSightRouteV2Ack")
    local request, owner, index, desired, cab, doors, light, auditPath
    local observedUseDown=false
    local observedPresses,observedEdges=0,0
    local useTarget,useEdge,boundEdge
    local function entityInfo(ent)
        if not IsValid(ent) then return nil end
        local p=ent:GetPos()
        return {class=ent:GetClass(),model=ent:GetModel(),map_creation_id=ent:MapCreationID(),position={p.x,p.y,p.z}}
    end
    local function audit(row)
        if not auditPath then return end
        local raw=util.TableToJSON(row).."\n"
        if math.max(file.Size(auditPath,"DATA"),0)+#raw>8*1024*1024 then error("use-audit-budget") end
        file.Append(auditPath,raw)
    end
    -- Preserve the original logged use target when the engine's proximity
    -- selector chooses another nearby leaf of the same doorway. This changes
    -- selection, not the E input count; unknown/far targets are never invented.
    hook.Add("FindUseEntity","FirstSightRouteV2BindRecordedTarget",function(ply,defaultEnt)
        if not request or ply~=owner or not IsValid(useTarget) or not IsValid(defaultEnt) or defaultEnt==useTarget then return end
        if useTarget:NearestPoint(ply:EyePos()):Distance(ply:EyePos())>160 then return end
        if boundEdge~=useEdge then
            audit({kind="recorded-target-binding",edge=useEdge,default_target=entityInfo(defaultEnt),selected_target=entityInfo(useTarget),basis="Explicit original input target, within 160 Source units; not an independent natural-target match"})
            boundEdge=useEdge
        end
        return useTarget
    end)
    hook.Add("KeyPress","FirstSightRouteV2UseDown",function(ply,key)
        if not request or ply~=owner or key~=IN_USE then return end
        observedUseDown=true;observedPresses=observedPresses+1;observedEdges=observedEdges+1
        local s=request.steps[index]
        audit({kind="observed-key-press",task=index,source_elapsed_s=s.source_elapsed_s,edge=s.use_edge_ordinal,entity=entityInfo(ply:GetEyeTrace().Entity)})
    end)
    hook.Add("KeyRelease","FirstSightRouteV2UseUp",function(ply,key)
        if not request or ply~=owner or key~=IN_USE then return end
        observedUseDown=false;observedEdges=observedEdges+1
        local s=request.steps[index]
        audit({kind="observed-key-release",task=index,source_elapsed_s=s.source_elapsed_s,edge=s.use_edge_ordinal})
    end)
    hook.Add("PlayerUse","FirstSightRouteV2ActualUse",function(ply,ent)
        if request and ply==owner then
            local s=request.steps[index]
            if IsValid(useTarget) and ent~=useTarget and useTarget:NearestPoint(ply:EyePos()):Distance(ply:EyePos())<=160 then
                audit({kind="blocked-adjacent-use-target",task=index,edge=useEdge,blocked_target=entityInfo(ent),recorded_target=entityInfo(useTarget)})
                return false
            end
            audit({kind="player-use",task=index,source_elapsed_s=s.source_elapsed_s,edge=s.use_edge_ordinal,actual_target=entityInfo(ent),recorded_target=s.recorded_target})
        end
    end)
    local function applyState()
        if not desired or not IsValid(cab) then return end
        cab:SetPos(desired.cab)
        cab:SetVelocity(Vector(0,0,0))
        for _,d in ipairs(doors) do
            if IsValid(d.ent) then d.ent:SetPos(d.position) end
        end
        if IsValid(light) then
            light:SetPos(desired.cab+Vector(0,0,67))
        end
    end
    hook.Add("Think","FirstSightRouteV2FreezeState",applyState)
    local function nextStep()
        if not request or not IsValid(owner) then return end
        index=index+1
        local s=request.steps[index]
        if not s then
            audit({kind="completed",observed_press_count=observedPresses,observed_edge_count=observedEdges,expected_press_count=request.expected_use_press_count,expected_edges=request.expected_use_edges})
            file.Write(auditPath..".summary.json",util.TableToJSON({observed_press_count=observedPresses,observed_edge_count=observedEdges,expected_press_count=request.expected_use_press_count,expected_edges=request.expected_use_edges},true))
            desired=nil;request=nil;return
        end
        local e=request.elevator
        local t=s.source_elapsed_s
        if s.kind=="use" then
            useTarget=nil;useEdge=s.use_edge_ordinal
            if s.use_down and s.recorded_target and s.recorded_target.model then
                for _,ent in ipairs(ents.GetAll()) do
                    if ent:GetModel()==s.recorded_target.model and ent:GetPos():Distance(Vector(unpack(s.recorded_target.position_source)))<2 then useTarget=ent;break end
                end
            end
        end
        local active=t>=e.active_start_s and t<=e.active_end_s
        local rise=0
        if t>=e.movement_start_s then
            rise=math.Clamp(s.player_position_source[3]-e.recorded_lower_foot_z,0,850)
        end
        local lowerOpen=t>=e.lower_open_start_s and t<=e.lower_open_end_s
        local upperOpen=t>=e.upper_open_start_s
        desired={cab=Vector(e.initial_origin[1],e.initial_origin[2],e.lower_origin_z+rise)}
        for _,d in ipairs(doors) do
            local opened=(d.info.group=="lower" and lowerOpen) or (d.info.group=="upper" and upperOpen) or (d.info.group=="cab" and (lowerOpen or upperOpen))
            d.position=Vector(unpack(d.info.origin))+Vector(0,opened and d.info.open_y or 0,d.info.group=="cab" and rise or 0)
        end
        applyState()
        owner:SetPos(Vector(unpack(s.player_position_source)))
        owner:SetEyeAngles(Angle(unpack(s.eye_angles_pyr_deg)))
        local telemetry={index=index,kind=s.kind,use_down=s.use_down,use_audit_path=auditPath,active=active,cab_index=cab:EntIndex(),expected_cab={desired.cab.x,desired.cab.y,desired.cab.z},lower_open=lowerOpen,upper_open=upperOpen,
            light_index=IsValid(light) and light:EntIndex() or -1,expected_light={desired.cab.x,desired.cab.y,desired.cab.z+67},doors={}}
        for _,d in ipairs(doors) do telemetry.doors[#telemetry.doors+1]={entity_index=d.ent:EntIndex(),model=d.info.model,expected={d.position.x,d.position.y,d.position.z}} end
        net.Start("FirstSightRouteV2Step");net.WriteTable(telemetry);net.Send(owner)
    end
    concommand.Add("fs_route_render_v2_begin",function(ply)
        if not game.SinglePlayer() or not IsValid(ply) or request then return end
        local r=util.JSONToTable(file.Read(REQUEST,"DATA") or "")
        if not r or r.schema~="first-sight-route-render-v2" or r.map~=game.GetMap() or #r.steps<1 or #r.steps>1000 then return end
        cab=ents.FindByName(r.elevator.name)[1]
        if not IsValid(cab) then return end
        doors={}
        for _,info in ipairs(r.elevator.doors) do
            local found
            for _,ent in ipairs(ents.GetAll()) do if ent:GetModel()==info.model then found=ent;break end end
            if not IsValid(found) then return end
            found:Fire("Lock","",0);found:SetMoveType(MOVETYPE_NONE)
            doors[#doors+1]={ent=found,info=info}
        end
        light=nil
        for _,ent in ipairs(ents.FindByClass("light_dynamic")) do
            if ent:GetParent()==cab then light=ent;break end
        end
        if IsValid(light) then light:Fire("TurnOn","",0) end
        cab:Fire("Stop","",0);cab:SetMoveType(MOVETYPE_NONE)
        -- Freeze suppresses IN_USE in the engine. Noclip + cleared movement keeps
        -- the render player stationary while allowing genuine CUserCmd E edges.
        ply:SetMoveType(MOVETYPE_NOCLIP);ply:Freeze(false);ply:SetNoDraw(true)
        auditPath="first_sight/route_render_v2_use_"..os.date("%Y%m%d_%H%M%S")..".jsonl.txt"
        if file.Exists(auditPath,"DATA") then return end
        request=r;owner=ply;index=0;observedUseDown=r.initial_use_down==true;observedPresses=0;observedEdges=0
        audit({kind="started",expected_edges=r.expected_use_edges,expected_press_count=r.expected_use_press_count,source_input_sha256=r.input_sha256})
        nextStep()
    end)
    net.Receive("FirstSightRouteV2Ack",function(_,ply)
        local completed=net.ReadUInt(16)
        if ply==owner and request and completed==index then
            local s=request.steps[index]
            local function check(attempt)
                if not request or completed~=index then return end
                if s.kind~="use" or observedUseDown==s.use_down then timer.Simple(.05,nextStep);return end
                if attempt<20 then timer.Simple(.05,function() check(attempt+1) end);return end
                audit({kind="failed",reason="use-key-transition-not-observed",task=index,expected=s.use_down,observed=observedUseDown})
                net.Start("FirstSightRouteV2Step");net.WriteTable({error="use-key-transition-not-observed",index=index});net.Send(owner)
                desired=nil;request=nil
            end
            check(0)
        end
    end)
    return
end

local request,root,pending,target,done,busy
local count,bytes,actions=0,0,0
local useDown=false
local commandAngles
local function finish(reason)
    if done or not root then return end
    done=true
    file.Write(root.."/summary.json",util.TableToJSON({reason=reason,samples=count,actions=actions,bytes=bytes,newly_rendered=true,
        original_footage=false,dynamic_reconstruction_scope="aptbld2 elevator only, pose-derived",presentation_time_scale=2},true))
end
hook.Add("InitPostEntity","FirstSightRouteV2Start",function()
    if not game.SinglePlayer() then return end
    local arm=util.JSONToTable(file.Read("first_sight_smoke_request.json","DATA") or "")
    if not arm or arm.mode~="render-route-v2" or math.abs(os.time()-arm.created_unix_s)>120 then return end
    request=util.JSONToTable(file.Read(REQUEST,"DATA") or "")
    if not request or request.schema~="first-sight-route-render-v2" or #request.steps<1 or #request.steps>1000 then return end
    file.Delete("first_sight_smoke_request.json")
    useDown=request.initial_use_down==true
    root="first_sight/route_render_v2_"..os.date("%Y%m%d_%H%M%S")
    if file.IsDir(root,"DATA") then root=nil;return end
    file.CreateDir(root)
    for _,view in ipairs({"front","left","right"}) do file.CreateDir(root.."/"..view) end
    target=GetRenderTarget("first_sight_route_v2",1024,1024)
    file.Write(root.."/metadata.json",util.TableToJSON({schema="first-sight-route-render-v2",map=game.GetMap(),width=640,height=480,
        original_footage=false,presentation_time_scale=2,nominal_presentation_fps=1,source_clock_preserved=true,
        dynamic_reconstruction_scope=request.dynamic_reconstruction_scope,source_recording=request.source_recording},true))
    timer.Simple(5,function() gui.HideGameUI();RunConsoleCommand("fs_route_render_v2_begin") end)
    timer.Simple(540,function() finish("render-timeout") end)
end)
net.Receive("FirstSightRouteV2Step",function()
    local state=net.ReadTable()
    if request and not done then
        if state.error then finish(state.error);return end
        local s=request.steps[state.index]
        commandAngles=Angle(unpack(s.eye_angles_pyr_deg))
        if s.kind=="use" then useDown=s.use_down end
        pending={state=state,ready=SysTime()+(s.kind=="use" and .10 or .35),deadline=SysTime()+3}
    end
end)
hook.Add("CreateMove","FirstSightRouteV2ReplayUse",function(cmd)
    if not request or done or not root then return end
    cmd:ClearButtons();cmd:ClearMovement()
    if commandAngles then cmd:SetViewAngles(commandAngles) end
    if useDown then cmd:SetButtons(IN_USE) end
end)
local function vec(v) return {v.x,v.y,v.z} end
hook.Add("PostRender","FirstSightRouteV2Capture",function()
    if busy or done or not pending or SysTime()<pending.ready then return end
    local step=pending;local state=step.state
    local entity=Entity(state.cab_index)
    if state.active and (not IsValid(entity) or entity:GetPos():Distance(Vector(unpack(state.expected_cab)))>1) then
        if SysTime()>step.deadline then finish("elevator-client-state-not-ready") end
        return
    end
    busy=true;pending=nil
    local pushed=false
    local ok,err=xpcall(function()
        local s=request.steps[state.index]
        if s.kind=="use" then
            file.Append(root.."/use_commands.jsonl.txt",util.TableToJSON({task=state.index,edge=s.use_edge_ordinal,source_elapsed_s=s.source_elapsed_s,presentation_elapsed_s=s.presentation_elapsed_s,use_down=useDown,recorded_target=s.recorded_target,server_audit=state.use_audit_path}).."\n")
            actions=actions+1
            net.Start("FirstSightRouteV2Ack");net.WriteUInt(state.index,16);net.SendToServer()
            return
        end
        local p=Vector(unpack(s.eye_position_source));local a=Angle(unpack(s.eye_angles_pyr_deg))
        local row={id=s.frame_id,task=state.index,source_elapsed_s=s.source_elapsed_s,presentation_elapsed_s=s.presentation_elapsed_s,views={},elevator=state}
        if state.active then
            row.elevator.client_cab_position=vec(entity:GetPos())
            local l=Entity(state.light_index)
            row.elevator.client_light_position=IsValid(l) and vec(l:GetPos()) or nil
            row.elevator.client_doors={}
            for _,d in ipairs(state.doors) do local ent=Entity(d.entity_index);row.elevator.client_doors[#row.elevator.client_doors+1]={model=d.model,position=IsValid(ent) and vec(ent:GetPos()) or nil} end
        end
        for _,view in ipairs({{"front",0},{"left",90},{"right",-90}}) do
            render.PushRenderTarget(target,0,0,640,480);pushed=true
            render.Clear(0,0,0,255,true,true)
            render.RenderView({origin=p,angles=Angle(a.p,a.y+view[2],a.r),x=0,y=0,w=640,h=480,aspect=640/480,
                fov=90,drawhud=false,drawviewmodel=false,drawviewer=false})
            local data=render.Capture({format="jpeg",quality=90,x=0,y=0,w=640,h=480,alpha=false})
            render.PopRenderTarget();pushed=false
            if not data or #data>2000000 or bytes+#data>256*1024*1024 then error("image-budget") end
            local path=string.format("%s/%06d.jpg",view[1],s.frame_id)
            file.Write(root.."/"..path,data)
            if file.Size(root.."/"..path,"DATA")~=#data then error("image-write-failed") end
            bytes=bytes+#data;row.views[view[1]]=path
        end
        file.Append(root.."/observations.jsonl.txt",util.TableToJSON(row).."\n")
        count=count+1
        net.Start("FirstSightRouteV2Ack");net.WriteUInt(state.index,16);net.SendToServer()
        if state.index==#request.steps then finish("completed") end
    end,debug.traceback)
    if pushed then render.PopRenderTarget() end
    busy=false
    if not ok then finish(tostring(err)) end
end)
