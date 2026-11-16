#!/usr/bin/env python3
"""Run the requested lai matrix with the existing local gateway reservation."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time


def write(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lai-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--wait-pid', type=int)
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    if args.wait_pid:
        print('Waiting for the active agent smoke process to finish.', flush=True)
        while True:
            try:
                os.kill(args.wait_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(2)
    coordination = args.lai_root / 'experiments/research-coordination'
    owner = coordination / 'compute-owner.json'
    with (coordination / '.coordination.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        previous = json.loads(owner.read_text()) if owner.exists() else {'status': 'released'}
        if previous.get('status') == 'reserved':
            raise RuntimeError('Another task owns the local compute reservation')
        write(args.output / 'gateway-owner-before.json', previous)
        reservation = {'status': 'reserved', 'owner': 'sllm-local-matrix', 'task': 'User-requested four-model multilingual inference benchmark', 'phase': 'full 192-case matrix', 'updated_epoch': time.time(), 'progress_record': str(args.output / 'run.json')}
        write(owner, reservation)
        child = None
        try:
            command = ['sllm', 'run', '--slots', 'flash-next,flash-next-uncensored,deepseek,deepseek-uncensored', '--languages', 'en,ste,zh,ru', '--profile', 'full', '--output', str(args.output)]
            if args.resume:
                command.append('--resume')
            print('Running: ' + ' '.join(command), flush=True)
            child = subprocess.Popen(command)
            code = child.wait()
            report_path = args.output / 'report.json'
            if not report_path.exists():
                raise RuntimeError(f'No report produced; exit code {code}')
            report = json.loads(report_path.read_text())
            print(json.dumps({'exit_code': code, 'completed': report['completed_cases'], 'planned': report['planned_cases'], 'harness_errors': report['harness_errors'], 'quality_passes': report['quality_passes']}), flush=True)
            if code not in (0, 2, 3):
                raise RuntimeError(f'Matrix execution failed with code {code}')
            if report['completed_cases'] != 192:
                raise RuntimeError('The requested 192-case matrix is incomplete')
        finally:
            if child and child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:
                    child.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    child.wait(timeout=10)
            current = json.loads(owner.read_text())
            if current.get('owner') == reservation['owner']:
                reservation.update(status='released', phase='matrix process finished', updated_epoch=time.time())
                write(owner, reservation)


if __name__ == '__main__':
    main()
