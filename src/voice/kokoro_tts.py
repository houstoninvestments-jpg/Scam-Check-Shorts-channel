"""Free, open-weight fallback voice (Kokoro, Apache-2.0). Reads a JSON job, writes one WAV per line.

Usage: python kokoro_tts.py job.json
job = {"model": ".../kokoro-v1.0.int8.onnx", "voices": ".../voices-v1.0.bin",
       "voice": "af_heart", "speed": 1.0, "out_dir": "...", "lines": [{"id": "hook", "text": "..."}]}
Prints {"segments": [{"id", "file", "duration"}]} as JSON.
"""
import json
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro


def main(job_path):
    job = json.loads(Path(job_path).read_text())
    tts = Kokoro(job["model"], job["voices"])
    out = Path(job["out_dir"])
    out.mkdir(parents=True, exist_ok=True)
    segments = []
    for line in job["lines"]:
        samples, rate = tts.create(line["text"], voice=job["voice"], speed=job.get("speed", 1.0), lang="en-us")
        file = out / f"{line['id']}.wav"
        sf.write(str(file), samples, rate)
        segments.append({"id": line["id"], "file": str(file), "duration": len(samples) / rate})
    print(json.dumps({"segments": segments}))


if __name__ == "__main__":
    main(sys.argv[1])
