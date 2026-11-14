"""Two-process, cancellable local jobs. No executable/user filesystem inputs."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from pipeline.dynamics.engines import validate

JOBS = {}
LOCK = threading.Lock()


def start(request):
    parameters = validate(request)
    with LOCK:
        if sum(j['status'] == 'running' for j in JOBS.values()) >= 2:
            raise ValueError('Two native jobs are already running; cancel or wait')
        # Retain at most eight completed records; returned exports remain portable.
        for key in list(JOBS):
            if JOBS[key]['status'] != 'running' and len(JOBS) >= 8:
                del JOBS[key]
        job_id = uuid.uuid4().hex
        env = dict(os.environ, MPLCONFIGDIR=os.path.join(tempfile.gettempdir(), 'egiz-mpl'), XDG_CACHE_HOME=os.path.join(tempfile.gettempdir(), 'egiz-cache'))
        process = subprocess.Popen([sys.executable, '-m', 'pipeline.dynamics', 'run'], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        job = {'status': 'running', 'process': process, 'created': time.monotonic()}
        JOBS[job_id] = job
    def work():
        try:
            stdout, stderr = process.communicate(json.dumps(parameters), timeout=60)
            with LOCK:
                if job['status'] != 'running':
                    return
                if process.returncode:
                    job.update(status='failed', error=stderr[-1500:] or 'Native engine failed')
                else:
                    job.update(status='complete', result=json.loads(stdout))
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            with LOCK:
                job.update(status='failed', error='Native execution exceeded 60 second wall-clock limit')
        except Exception as error:
            with LOCK:
                job.update(status='failed', error=str(error))
    threading.Thread(target=work, daemon=True).start()
    return {'id': job_id, 'status': 'running'}


def status(job_id, cancel=False):
    with LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise ValueError('Unknown or expired native job')
        if cancel and job['status'] == 'running':
            job['status'] = 'cancelled'
            job['process'].kill()
        return {key: job[key] for key in ['status', 'result', 'error'] if key in job}
