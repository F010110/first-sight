-- Minimal local life-view mode: no weapons/combat HUD, no forced downloads.
-- Does not turn Sandbox or the stock test map into a complete life simulator.
if not game.SinglePlayer() then return end
CreateConVar("fs_life_mode", "1", FCVAR_REPLICATED, "First-Sight local no-combat mode", 0, 1)
local function enabled() return GetConVar("fs_life_mode"):GetBool() end

hook.Add("PlayerLoadout", "FirstSightNoLoadout", function(ply)
    if not enabled() then return end
    ply:StripWeapons()
    ply:StripAmmo()
    return true
end)
hook.Add("PlayerSpawn", "FirstSightNoWeaponsOnSpawn", function(ply)
    timer.Simple(0, function()
        if enabled() and IsValid(ply) then ply:StripWeapons(); ply:StripAmmo() end
    end)
end)
for _, name in ipairs({"PlayerCanPickupWeapon", "PlayerGiveSWEP", "PlayerSpawnSWEP"}) do
    hook.Add(name, "FirstSightNoWeapons", function()
        if enabled() then return false end
    end)
end
hook.Add("EntityTakeDamage", "FirstSightNoPlayerCombat", function(ent, damage)
    if enabled() and ent:IsPlayer() then damage:SetDamage(0); return true end
end)
hook.Add("PlayerNoClip", "FirstSightWalkNotFly", function(_, desired)
    if enabled() and desired then return false end
end)
