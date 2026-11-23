"""Optional Lua execution under API mocks. NOT an engine/render validation."""
from pathlib import Path
import unittest
try:
    from lupa import LuaRuntime
except ImportError:
    LuaRuntime = None

ROOT = Path(__file__).resolve().parents[2]
MOCK = r'''
CLIENT=true; VERSIONSTR="test-mock-not-game"
now=0; wall=0; frame=1; tick=1; depth=0; captureMode="ok"; single=true
writes={}; dirs={}; jsonTables={}; hooks={}; commands={}; captures=0
local V={}; V.__index=V
function Vector(x,y,z) return setmetatable({x=x,y=y,z=z},V) end
function V.__mul(a,b) return Vector(a.x*b,a.y*b,a.z*b) end
function V.__unm(a) return a*-1 end
function V.__add(a,b) return Vector(a.x+b.x,a.y+b.y,a.z+b.z) end
local A={}; A.__index=A
function Angle(p,y,r) return setmetatable({p=p,y=y,r=r},A) end
function A:Forward() local y=math.rad(self.y);return Vector(math.cos(y),math.sin(y),0) end
function A:Right() local y=math.rad(self.y);return Vector(math.sin(y),-math.cos(y),0) end
function A:Up() return Vector(0,0,1) end
function LocalToWorld(v,a,p,h) return p+v,Angle(h.p+a.p,h.y+a.y,h.r+a.r) end
function CreateClientConVar(k,d) return {GetFloat=function() return tonumber(d) end} end
function SysTime() return wall end; function CurTime() return now end
function FrameNumber() return frame end
game={SinglePlayer=function() return single end,GetMap=function() return "TEST_FIXTURE" end}
engine={TickCount=function() return tick end}
ply={EyePos=function() return Vector(1,2,3) end,EyeAngles=function() return Angle(0,0,0) end,
 GetVelocity=function() return Vector(0,0,0) end}
function LocalPlayer() return ply end; function IsValid(x) return x~=nil end
file={Write=function(p,s) writes[p]=s end,Append=function(p,s) writes[p]=(writes[p] or "")..s end,
 Size=function(p) return writes[p] and #writes[p] or -1 end,
 CreateDir=function(p) dirs[p]=true end,IsDir=function(p) return dirs[p] or false end}
util={TableToJSON=function(t) jsonTables[#jsonTables+1]=t;return "mock-json-"..#jsonTables end,
 CRC=function(s) return tostring(#s) end}
hook={Add=function(event,name,fn) hooks[event]=fn end}
concommand={Add=function(name,fn) commands[name]=fn end}
gui={IsGameUIVisible=function() return false end}
function GetRenderTarget() return {Width=function() return 1024 end,Height=function() return 1024 end} end
render={PushRenderTarget=function() depth=depth+1 end,PopRenderTarget=function() depth=depth-1 end,
 Clear=function() end, RenderView=function(view)
  viewAngle=view.angles.y
  if captureMode=="render-error" then error("mock render failure") end
  if captureMode=="reentrant" then hooks.PostRender() end
 end,Capture=function()
  captures=captures+1
  if captureMode=="nil" then return nil end
  if captureMode=="oversize" then return string.rep("x",2097153) end
  if captureMode=="advance" then tick=tick+1 end
  return "MOCK-NOT-A-PNG:"..viewAngle
 end}
function countImages() local n=0;for p,_ in pairs(writes) do if p:match("%.png$") then n=n+1 end end;return n end
function latestReason() return jsonTables[#jsonTables].reason end
'''

@unittest.skipIf(LuaRuntime is None, 'Requires isolated lupa tool; not installed into project dependencies')
class GmodLuaMockTests(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute(MOCK)
        self.lua.execute((ROOT/'integrations/gmod/first_sight_capture/lua/autorun/client/first_sight_capture.lua').read_text())

    def evaluate(self, code): return self.lua.execute(code)

    def test_no_recording_on_load_and_single_player_guard(self):
        self.assertEqual(self.evaluate('return countImages()'), 0)
        self.evaluate('single=false;commands.fs_capture_start();hooks.PostRender()')
        self.assertEqual(self.evaluate('return countImages()'), 0)

    def test_static_triplet_and_rt_cleanup(self):
        self.evaluate('commands.fs_capture_static();hooks.PostRender()')
        self.assertEqual(self.evaluate('return countImages(),depth,latestReason()'), (3, 0, 'sample-limit'))

    def test_30_samples_stop_and_no_recursive_capture(self):
        self.evaluate('captureMode="reentrant";commands.fs_capture_start();for i=0,29 do now=i*2;wall=i*2;frame=i+1;tick=i+1;hooks.Think();hooks.PostRender() end')
        self.assertEqual(self.evaluate('return countImages(),depth,captures,latestReason()'), (90, 0, 90, 'sample-limit'))
        self.evaluate('hooks.PostRender()')
        self.assertEqual(self.evaluate('return captures'), 90)

    def test_failed_capture_restores_rt_and_commits_no_triplet(self):
        for mode in ['nil', 'oversize', 'render-error', 'advance']:
            self.setUp()
            self.evaluate(f'captureMode="{mode}";commands.fs_capture_static();hooks.PostRender()')
            self.assertEqual(self.evaluate('return countImages(),depth'), (0, 0))

    def test_wall_time_stop_without_render(self):
        self.evaluate('commands.fs_capture_start();wall=66;hooks.Think()')
        self.assertEqual(self.evaluate('return latestReason()'), 'wall-time-limit')

    def test_motion_request_drives_commands_without_os_input_and_stops(self):
        self.evaluate('''
            math.Clamp=function(v,a,b) return math.max(a,math.min(b,v)) end
            file.Read=function() return "explicit-mock-request" end
            util.JSONToTable=function() return {mode="motion-video",created_unix_s=os.time()} end
            file.Delete=function() end
            gui.HideGameUI=function() end
            timer={Simple=function(_,fn) fn() end}
            hooks.InitPostEntity()
            cmd={ClearButtons=function() end,ClearMovement=function(self) self.forward=0 end,
                 SetViewAngles=function(self,a) self.angle=a end,SetForwardMove=function(self,f) self.forward=f end}
            now=.1;hooks.CreateMove(cmd)
        ''')
        self.assertEqual(self.evaluate('return cmd.forward'),60)
        self.evaluate('now=13.5;hooks.CreateMove(cmd)')
        self.assertEqual(self.evaluate('return cmd.forward,cmd.angle.y'),(0,45))
        self.evaluate('now=60;hooks.Think()')
        self.assertEqual(self.evaluate('return latestReason()'),'duration-limit')

if __name__ == '__main__': unittest.main()
