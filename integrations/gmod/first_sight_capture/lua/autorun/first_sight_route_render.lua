-- NEW synthetic observation rendering along recorded poses; not physical replay.
if SERVER then
    AddCSLuaFile()
    util.AddNetworkString("FirstSightRouteStep")
    util.AddNetworkString("FirstSightRouteAck")
    local steps, index, owner
    local function nextStep()
        if not IsValid(owner) or not steps then return end
        index=index+1
        local s=steps[index]
        if not s then steps=nil return end
        owner:SetPos(Vector(unpack(s.player_position_source)))
        owner:SetEyeAngles(Angle(unpack(s.eye_angles_pyr_deg)))
        net.Start("FirstSightRouteStep"); net.WriteUInt(index,16); net.Send(owner)
    end
    concommand.Add("fs_route_render_begin",function(ply)
        if not game.SinglePlayer() or not IsValid(ply) or steps then return end
        local request=util.JSONToTable(file.Read("first_sight/route_render_request.json","DATA") or "")
        if not request or request.map~=game.GetMap() or #request.steps>600 then return end
        steps=request.steps;index=0;owner=ply;nextStep()
    end)
    net.Receive("FirstSightRouteAck",function(_,ply)
        if ply==owner and steps then timer.Simple(.1,nextStep) end
    end)
    return
end
local request,root,pending,target,done
local count,bytes=0,0
local function finish(reason)
    if done or not root then return end
    done=true
    file.Write(root.."/summary.json",util.TableToJSON({reason=reason,samples=count,bytes=bytes,
        newly_rendered=true,original_footage=false,dynamic_state_reconstructed=false},true))
end
hook.Add("InitPostEntity","FirstSightRouteRenderStart",function()
    if not game.SinglePlayer() then return end
    local raw=file.Read("first_sight_smoke_request.json","DATA")
    local arm=raw and util.JSONToTable(raw)
    if not arm or arm.mode~="render-route" or math.abs(os.time()-arm.created_unix_s)>120 then return end
    request=util.JSONToTable(file.Read("first_sight/route_render_request.json","DATA") or "")
    if not request or request.map~=game.GetMap() or #request.steps<1 or #request.steps>600 then return end
    file.Delete("first_sight_smoke_request.json")
    root="first_sight/route_render_"..os.date("%Y%m%d_%H%M%S")
    if file.IsDir(root,"DATA") then root=nil return end
    file.CreateDir(root)
    for _,view in ipairs({"front","left","right"}) do file.CreateDir(root.."/"..view) end
    target=GetRenderTarget("first_sight_route_render",1024,1024)
    file.Write(root.."/metadata.json",util.TableToJSON({schema="first-sight-route-render-v1",
        map=game.GetMap(),newly_rendered=true,source_recording=request.source_recording,
        dynamic_state_reconstructed=false,pose_for_renderer_and_gold_only=true,width=640,height=480},true))
    timer.Simple(5,function() gui.HideGameUI();RunConsoleCommand("fs_route_render_begin") end)
    timer.Simple(500,function() finish("render-timeout") end)
end)
net.Receive("FirstSightRouteStep",function()
    local i=net.ReadUInt(16)
    if request and not done then pending={index=i,ready=SysTime()+.5} end
end)
local busy=false
hook.Add("PostRender","FirstSightRouteRenderCapture",function()
    if busy or done or not pending or SysTime()<pending.ready then return end
    busy=true
    local step=pending;pending=nil
    local pushed=false
    local ok,err=xpcall(function()
        local s=request.steps[step.index]
        local p=Vector(unpack(s.eye_position_source));local a=Angle(unpack(s.eye_angles_pyr_deg))
        local row={id=step.index,source_elapsed_s=s.source_elapsed_s,views={}}
        for _,view in ipairs({{"front",0},{"left",90},{"right",-90}}) do
            render.PushRenderTarget(target,0,0,640,480);pushed=true
            render.Clear(0,0,0,255,true,true)
            render.RenderView({origin=p,angles=Angle(a.p,a.y+view[2],a.r),x=0,y=0,w=640,h=480,
                aspect=640/480,fov=90,drawhud=false,drawviewmodel=false,drawviewer=false})
            local data=render.Capture({format="jpeg",quality=85,x=0,y=0,w=640,h=480,alpha=false})
            render.PopRenderTarget();pushed=false
            if not data or #data>2000000 or bytes+#data>128*1024*1024 then error("image-budget") end
            local path=string.format("%s/%06d.jpg",view[1],step.index)
            file.Write(root.."/"..path,data)
            if file.Size(root.."/"..path,"DATA")~=#data then error("image-write-failed") end
            bytes=bytes+#data;row.views[view[1]]=path
        end
        file.Append(root.."/observations.jsonl.txt",util.TableToJSON(row).."\n")
        count=count+1
        if count==#request.steps then finish("completed") else
            net.Start("FirstSightRouteAck");net.SendToServer()
        end
    end,debug.traceback)
    if pushed then render.PopRenderTarget() end
    busy=false
    if not ok then finish(tostring(err)) end
end)
