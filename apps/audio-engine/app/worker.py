"""Single-job analysis subprocess. Emits progress and result as JSON lines."""
import json
import sys
import soundfile as sf
from .analysis import analyse


def send(value):
    print(json.dumps(value, ensure_ascii=True, allow_nan=False), flush=True)


def main(path):
    try:
        y, sr = sf.read(path, dtype='float32')
        result = analyse(y, sr, lambda value, message: send(
            {'type': 'progress', 'progress': value, 'message': message}))
        send({'type': 'result', 'result': result})
    except ValueError as exc:
        send({'type': 'error', 'message': str(exc)})
        return 1
    except Exception:
        import traceback
        traceback.print_exc(file=sys.stderr)
        send({'type': 'error', 'message': 'Analysis failed. Try a shorter, clearer recording.'})
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
