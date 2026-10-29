"""Original understated electronic score, synthesized from oscillators. No samples."""
import math, wave, struct, random
from pathlib import Path
RATE = 44100
DURATION = 40
N = RATE * DURATION
left = [0.0] * N
right = [0.0] * N
rng = random.Random(49)
def midi(n): return 440 * 2 ** ((n - 69) / 12)
def tone(start, duration, note, gain=.1, pan=0, kind='bell'):
    freq = midi(note)
    offset = round(start * RATE)
    count = min(round(duration * RATE), N-offset)
    for j in range(max(0,count)):
        t = j/RATE
        if kind == 'pad':
            env = min(1,t/.45) * min(1,(duration-t)/.65)
            value = (math.sin(2*math.pi*freq*t)+.3*math.sin(2*math.pi*freq*1.003*t)+.15*math.sin(4*math.pi*freq*t))/1.45
        elif kind == 'bass':
            env = min(1,t/.025)*math.exp(-t*3.2)*min(1,(duration-t)/.12)
            value = math.sin(2*math.pi*freq*t)+.12*math.sin(4*math.pi*freq*t)
        else:
            env = min(1,t/.008)*math.exp(-t*3.8)*min(1,(duration-t)/.1)
            value = math.sin(2*math.pi*freq*t)+.19*math.sin(2*math.pi*freq*2*t)*math.exp(-t*5)
        v = value*env*gain
        left[offset+j] += v*math.sqrt((1-pan)/2)
        right[offset+j] += v*math.sqrt((1+pan)/2)

def percussion(start, kick=False, gain=.035):
    duration=.22 if kick else .055
    offset=round(start*RATE)
    for j in range(min(round(duration*RATE),N-offset)):
        t=j/RATE
        if kick: value=math.sin(2*math.pi*(48*t+3*(1-math.exp(-t*35))))*math.exp(-t*22)
        else: value=(rng.random()*2-1)*math.exp(-t*95)*(.7+.3*math.sin(2*math.pi*7000*t))
        left[offset+j]+=value*gain;right[offset+j]+=value*gain

# 100 BPM. Warm major-seventh voicings and a restrained plucked motif.
chords=[[48,55,59,64],[45,52,55,59],[41,48,52,57],[43,50,55,59]]
for k,start in enumerate([0,4.8,9.6,14.4,19.2,24,28.8,33.6,38.4]):
    chord=chords[k%4]
    for idx,note in enumerate(chord): tone(start,min(5.1,40-start),note,.032,(idx-1.5)*.35,'pad')
    if start<38:
        for step in range(8):
            t=start+step*.6
            if t<37:
                note=chord[[0,2,1,3,2,1,3,2][step]]+24
                tone(t,1.15,note,.045 if step%2==0 else .027,(-.35 if step%2==0 else .35))
                if step%2==0:tone(t,.6,chord[0]-12,.075,0,'bass')
for i in range(6,62):
    t=i*.6
    percussion(t,kick=i%2==0,gain=.055 if i%2==0 else .018)
    if i%2:percussion(t+.3,gain=.009)
# Light tonal accents tied to the file drop, approval, and retest completion.
for t,notes in [(6.6,[76,79]),(28.1,[72,76]),(31.9,[72,76,79]),(36.5,[60,67,72,76])]:
    for i,note in enumerate(notes):tone(t+i*.09,1.8,note,.055,-.2+i*.15)
peak=max(max(abs(x) for x in left),max(abs(x) for x in right))
out=Path(__file__).parent/'output'/'soundtrack.wav'
out.parent.mkdir(exist_ok=True)
with wave.open(str(out),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
    buf=bytearray()
    for i in range(N):
        t=i/RATE
        fade=min(1,t/.5)*min(1,(DURATION-t)/1.8)
        for channel in (left,right):buf.extend(struct.pack('<h',int(max(-1,min(1,channel[i]/max(peak,.01)*.65*fade))*32767)))
        if len(buf)>=65536:f.writeframesraw(buf);buf.clear()
    f.writeframes(buf)
print(f'Created {out}: 40s, stereo, 44.1kHz; original synthesized score')
