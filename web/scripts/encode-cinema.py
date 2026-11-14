"""Derive web renditions of the landing film from the 4K masters.

Masters live in web/media-src/cinematic/<group>/<name>.mp4 (not committed). For each clip this writes
into web/public/media/cinematic/<group>/:
  <name>-1080.mp4  1920x1080, CRF 17 (visually lossless at this size)   desktop
  <name>-720.mp4   1280x720,  CRF 20                                     phones
  <name>.jpg       first frame, 1920 px     (poster while the video loads)
  <name>-end.jpg   last frame,  1920 px     (held when the film hands off)
Scroll-scrubbed clips get a keyframe every 4 frames so seeking to any scroll position is instant;
played clips keep normal GOPs and their audio (it plays only when the visitor turns sound on).

Usage:  python web/scripts/encode-cinema.py [name ...]
AI-assisted implementation; human review pending.
"""
import pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC, OUT = ROOT / 'media-src' / 'cinematic', ROOT / 'public' / 'media' / 'cinematic'
CLIPS = {  # name: (group, scrubbed)
    's1-arrival': ('hero', False), 's2-twin': ('earth', True), 's3-return': ('moon', True),
    's4-passage': ('transitions', True), 's5-jezero': ('mars', True), 's6-answer': ('missions', False),
    's7-home': ('orbital', True),
}


def ffmpeg_exe():
    exe = shutil.which('ffmpeg')
    if exe: return exe
    import imageio_ffmpeg  # bundled binary fallback
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(*args):
    subprocess.run([ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-y', *map(str, args)], check=True)


def encode(name):
    group, scrub = CLIPS[name]
    src = SRC / group / f'{name}.mp4'
    if not src.exists():
        print(f'skip {name}: no master at {src}'); return
    dst = OUT / group; dst.mkdir(parents=True, exist_ok=True)
    gop = ['-g', '4', '-keyint_min', '4', '-sc_threshold', '0'] if scrub else ['-g', '48']
    audio = ['-an'] if scrub else ['-c:a', 'aac', '-b:a', '160k']
    for height, width, crf in ((1080, 1920, 17), (720, 1280, 20)):
        run('-i', src, '-vf', f'scale={width}:{height}:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', crf,
            '-profile:v', 'high', '-pix_fmt', 'yuv420p', *gop, *audio, '-movflags', '+faststart', dst / f'{name}-{height}.mp4')
    run('-i', src, '-vf', 'select=eq(n\\,0),scale=1920:-2:flags=lanczos', '-frames:v', '1', '-q:v', '2', dst / f'{name}.jpg')
    run('-sseof', '-0.2', '-i', src, '-update', '1', '-vf', 'scale=1920:-2:flags=lanczos', '-q:v', '2', dst / f'{name}-end.jpg')
    sizes = ', '.join(f'{p.name} {p.stat().st_size / 1e6:.1f} MB' for p in sorted(dst.glob(f'{name}*')))
    print(f'{name}: {sizes}', flush=True)


if __name__ == '__main__':
    for n in (sys.argv[1:] or CLIPS):
        encode(n)
