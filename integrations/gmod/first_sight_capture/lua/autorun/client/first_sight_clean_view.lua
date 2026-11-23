-- Main player display only. Captured views separately disable HUD/viewmodel.
local hidden = {
    CHudHealth = true, CHudBattery = true, CHudAmmo = true, CHudSecondaryAmmo = true,
    CHudCrosshair = true, CHudWeaponSelection = true, CHudDamageIndicator = true,
    CHudSuitPower = true, CHudPoisonDamageIndicator = true, CHudZoom = true
}
-- Default to a visible free cursor; automation does not need physical mouse input.
local freeCursor = CreateClientConVar("fs_cursor_free", "1", false, false, "Keep cursor free in First-Sight local mode", 0, 1)
local function enabled()
    local mode = GetConVar("fs_life_mode")
    return game.SinglePlayer() and mode and mode:GetBool()
end
hook.Add("HUDShouldDraw", "FirstSightCleanHUD", function(name)
    if enabled() and hidden[name] then return false end
end)
hook.Add("PreDrawViewModel", "FirstSightNoWeaponModel", function()
    if enabled() then return true end
end)
hook.Add("HUDDrawTargetID", "FirstSightNoGameTargetLabels", function()
    if enabled() then return false end
end)
hook.Add("Think", "FirstSightFreeCursor", function()
    if enabled() and freeCursor:GetBool() then gui.EnableScreenClicker(true) end
end)
hook.Add("InputMouseApply", "FirstSightIgnorePhysicalMouse", function(cmd)
    if enabled() and freeCursor:GetBool() then
        cmd:SetMouseX(0)
        cmd:SetMouseY(0)
        return true
    end
end)
