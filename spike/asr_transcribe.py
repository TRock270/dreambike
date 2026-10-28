"""Optional Muse Voice Transcribe profile of POST /v1/asr/transcribe (SPEC.md 6.4).

python spike/asr_transcribe.py --audio fixtures/command.wav

The WAV is checked locally first: RIFF/WAVE, PCM, mono, 16-bit, 24 kHz, at most
30 seconds. Voice is optional; a missing file exits 5 (skipped).
"""

from __future__ import annotations

import json
import math
import struct
import uuid
from pathlib import Path

import common

MODEL = "muse-voice-transcribe-1.0"
DEADLINE_S = 40


def wav_info(data: bytes) -> dict[str, int]:
    """Parse RIFF chunks; raise ValueError on anything but mono PCM16 24 kHz."""
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    pos, fmt, frames = 12, None, None
    while pos + 8 <= len(data):
        kind, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        payload = data[pos + 8:pos + 8 + size]
        if kind == b"fmt ":
            fmt = struct.unpack("<HHIIHH", payload[:16])
        elif kind == b"data":
            frames = len(payload) // 2
        pos += 8 + size + (size & 1)
    if fmt is None or frames is None:
        raise ValueError("missing fmt or data chunk")
    audio_format, channels, rate, _, _, bits = fmt
    if (audio_format, channels, rate, bits) != (1, 1, 24000, 16):
        raise ValueError(f"need PCM mono 24000 Hz 16-bit, got {audio_format}/{channels}/{rate}/{bits}")
    duration_ms = frames * 1000 // rate
    if not 0 < duration_ms <= 30000:
        raise ValueError(f"duration {duration_ms} ms outside 1..30000")
    return {"durationMs": duration_ms, "frames": frames}


def main() -> int:
    parser = common.base_parser(__doc__.splitlines()[0])
    parser.add_argument("--audio", type=Path, default=common.FIXTURES / "command.wav")
    args = parser.parse_args()
    path = args.audio if args.audio.is_absolute() else common.REPO / args.audio
    if not path.exists():
        raise common.SpikeExit(common.EXIT_SKIPPED, "No owner voice recording; ASR profile skipped.")
    data = path.read_bytes()
    try:
        info = wav_info(data)
    except ValueError as exc:
        raise common.SpikeExit(common.EXIT_ASSERTION, f"WAV check failed: {exc}")
    request = {"model": MODEL, "mode": "PUSH_TO_TALK", "audioEncoding": "WAV"}
    session = str(uuid.uuid4())
    if args.dry_run:
        print(json.dumps({"wav": info, "request": request, "query": {"sessionId": "<uuid>"},
                          "audioPart": {"filename": "command.wav", "mime": "audio/wav",
                                        "bytes": len(data)}}, indent=2))
        return common.EXIT_PASSED
    config = common.Config.load()
    budget = common.Budget(config, args.ticket)
    per_hour = common.load_prices()["prices"][MODEL]["microUsdPerHour"]

    def charge(r: common.HttpResult) -> int | None:
        ms = json.loads(r.body).get("audioDurationMs")
        return math.ceil(ms * per_hour / 3_600_000) if isinstance(ms, int) else None

    result = common.paid_call(
        budget, profile="asr", route="/asr/transcribe", model=MODEL,
        amount=common.load_prices()["reservations"]["asr-30s"], body_for_fingerprint=data,
        deadline_s=DEADLINE_S,
        dispatch=lambda: common.meta_post(
            config, "/asr/transcribe", params={"sessionId": session}, deadline_s=DEADLINE_S,
            files={"request": (None, json.dumps(request), "application/json"),
                   "audio": ("command.wav", data, "audio/wav")}),
        charge=charge)
    summary = {"wav": info, **common.response_summary(result)}
    ok = result.status == 200
    if ok:
        response = json.loads(result.body)
        summary["responseStructure"] = common.structure(response)
        ok = isinstance(response.get("transcript"), str) and "audioDurationMs" in response
    common.write_result("asr", path.name, "passed" if ok else "failed",
                        common.sha256_hex(data), summary)
    print(f"asr: {'passed' if ok else 'failed'} (HTTP {result.status})")
    return common.EXIT_PASSED if ok else common.EXIT_ASSERTION


if __name__ == "__main__":
    common.run_main(main)
