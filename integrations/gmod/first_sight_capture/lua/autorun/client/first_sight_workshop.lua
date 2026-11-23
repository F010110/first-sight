-- Explicit one-item Steam download. Never subscribes to collections or mounts code.
hook.Add("InitPostEntity", "FirstSightApprovedMapDownload", function()
    if not game.SinglePlayer() then return end
    local requestPath = "first_sight_smoke_request.json"
    local raw = file.Read(requestPath, "DATA")
    if not raw then return end
    local request = util.JSONToTable(raw)
    if not request or request.mode ~= "download-unioncity" then return end
    if type(request.created_unix_s) ~= "number" or math.abs(os.time()-request.created_unix_s) > 120 then return end
    file.Delete(requestPath)
    local folder = "first_sight/map_download_" .. os.time()
    file.CreateDir(folder)
    local function finish(row)
        row.workshop_id = "1681190843"
        row.mounted = false
        row.dependencies_downloaded = false
        file.Write(folder .. "/summary.json", util.TableToJSON(row, true))
    end
    steamworks.FileInfo("1681190843", function(info)
        if not info or type(info.size) ~= "number" or info.size <= 0 or info.size > 2000000000 then
            finish({success=false, reason="missing-info-or-budget-exceeded"}) return
        end
        file.Write(folder .. "/source.json", util.TableToJSON({title=info.title,size=info.size,updated=info.updated,fileid=info.fileid},true))
        steamworks.DownloadUGC("1681190843", function(path, handle)
            if not path or not handle then finish({success=false, reason="steam-download-failed"}) return end
            local size = handle:Size()
            finish({success=size > 0 and size <= 2000000000, path=path, bytes=size, reason="download-returned"})
        end)
    end)
end)
