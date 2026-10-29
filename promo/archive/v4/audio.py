"""Original spooky-playful score: minor-key music box, ghostly swells, soft pulses."""
import math, wave, struct, random
from pathlib import Path
RATE, DURATION = 44100, 32
N = RATE * DURATION
left, right = [0.0] * N, [0.0] * N
rng = random.Random(313)

def midi(n): return 440 * 2 ** ((n - 69) / 12)

def tone(start, duration, note, gain=.05, pan=0, kind='bell'):
    freq, offset = midi(note), round(start*RATE)
    count = min(round(duration*RATE),N-offset)
    phase=0
    for j in range(max(0,count)):
        t=j/RATE
        if kind=='pad':
            env=min(1,t/.65)*min(1,(duration-t)/.9)
            value=(math.sin(2*math.pi*freq*t)+.45*math.sin(2*math.pi*freq*.997*t)+.2*math.sin(4*math.pi*freq*t))/1.65
            value*=.78+.22*math.sin(2*math.pi*2.3*t)
        elif kind=='ghost':
            env=math.sin(math.pi*t/duration)**1.4
            vibrato=.012*math.sin(2*math.pi*5.2*t)*min(1,t/.4)
            glide=1-.12*math.exp(-t*5)
            phase+=2*math.pi*freq*glide*(1+vibrato)/RATE
            value=math.sin(phase)+.12*math.sin(phase*2)
        elif kind=='bass':
            env=min(1,t/.025)*math.exp(-t*4)*min(1,(duration-t)/.15)
            value=math.sin(2*math.pi*freq*t)+.1*math.sin(4*math.pi*freq*t)
        else:
            env=min(1,t/.008)*math.exp(-t*2.6)*min(1,(duration-t)/.2)
            value=math.sin(2*math.pi*freq*t)+.25*math.sin(2*math.pi*freq*2.76*t)*math.exp(-t*5)+.07*math.sin(2*math.pi*freq*5.4*t)*math.exp(-t*8)
        value*=env*gain
        left[offset+j]+=value*math.sqrt((1-pan)/2)
        right[offset+j]+=value*math.sqrt((1+pan)/2)

def pulse(start,gain=.045):
    offset=round(start*RATE)
    for j in range(min(round(.25*RATE),N-offset)):
        t=j/RATE
        v=math.sin(2*math.pi*(42*t+2.2*(1-math.exp(-t*30))))*math.exp(-t*20)*gain
        left[offset+j]+=v;right[offset+j]+=v

def air(start,duration,gain=.025):
    offset=round(start*RATE);smooth=0
    for j in range(min(round(duration*RATE),N-offset)):
        t=j/RATE;p=t/duration
        smooth=.86*smooth+.14*(rng.random()*2-1)
        v=smooth*(math.sin(math.pi*p)**1.5)*gain
        pan=.7*math.sin(p*math.pi*4)
        left[offset+j]+=v*(1-pan);right[offset+j]+=v*(1+pan)

# D minor, B-flat, G minor, and A tension. D minor resolves the final brand hold.
chords=[[50,53,57,60],[46,53,57,62],[43,50,58,62],[45,52,55,61]]
for bar,start in enumerate([0,4.8,9.6,14.4,19.2,24]):
    chord=chords[bar%4]
    for i,n in enumerate(chord):tone(start,5.5,n,.025,(i-1.5)*.35,'pad')
    melody=[chord[0]+24,chord[1]+24,chord[2]+24,chord[1]+24,chord[3]+12,chord[2]+12]
    for i,offset in enumerate([0,.9,1.2,2.4,2.7,3.6]):
        t=start+offset
        tone(t,1.7,melody[i],.055 if i%2==0 else .034,(-.3 if i%2==0 else .3))
        tone(t+.24,1.4,melody[i],.013,(.6 if i%2==0 else -.6))
    for step in range(4):
        tone(start+step*1.2,.8,chord[0]-12,.065,0,'bass')
        pulse(start+step*1.2,.024)
# Soft, breathy ghost calls enter with the personalities and climb during the vortex.
for start,duration,n,gain,pan in [(7.5,1.7,74,.052,-.35),(8.1,1.8,77,.05,.35),(10,2.4,69,.045,-.4),(11.2,2.6,81,.045,.4),(14.6,1.9,73,.035,-.25),(23.3,2.5,74,.04,.2)]:
    tone(start,duration,n,gain,pan,'ghost')
# Upload completion, approval, and successful retest get quiet, clear chimes.
for start,notes in [(2.85,[74,77]),(4.5,[74,81]),(21.65,[69,74]),(26,[74,77,81]),(29,[62,69,74,77])]:
    for i,n in enumerate(notes):tone(start+i*.1,2.0,n,.045,-.25+i*.15)
for n in [38,50,53,57]:tone(28.8,3.2,n,.025,0,'pad')
for t in [1.05,7.65,7.95,8.25,16.2,16.5,16.8,21.65]:pulse(t,.035)
for args in [(3.75,.9,.035),(7.15,.9,.022),(10.1,3.8,.07),(14,1.1,.025),(28.25,.8,.04)]:air(*args)
# Short cross-channel room reflections, applied only to the original dry samples.
for i in range(N-1,-1,-1):
    for delay,amount in [(int(.13*RATE),.12),(int(.31*RATE),.08),(int(.47*RATE),.04)]:
        if i>=delay:
            left[i]+=right[i-delay]*amount
            right[i]+=left[i-delay]*amount
peak=max(max(abs(x) for x in left),max(abs(x) for x in right))
out=Path(__file__).parent/'output'/'soundtrack-v3.wav'
out.parent.mkdir(exist_ok=True)
with wave.open(str(out),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
    buf=bytearray()
    for i in range(N):
        t=i/RATE;fade=min(1,t/.3)*min(1,(DURATION-t)/1.4)
        for channel in (left,right):buf.extend(struct.pack('<h',int(max(-1,min(1,channel[i]/max(peak,.01)*.65*fade))*32767)))
        if len(buf)>=65536:f.writeframesraw(buf);buf.clear()
    f.writeframes(buf)
print(f'Created {out}: 32s, stereo, 44.1kHz; original spooky minor-key score')
