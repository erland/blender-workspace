"""Opt-in, real Modal comparison of a fixed Blender workload.

Run from repository root:
    python -m pip install 'modal>=1.5,<2'
    modal token set
    python experiments/modal_function_vs_sandbox.py --execute --iterations 3

Never runs cloud compute unless --execute is explicitly supplied.
No credentials, user-supplied Python, source project files or volumes
are mounted in either the Function or the Sandbox.
"""
import argparse
import json
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import modal

REPOSITORY=Path(__file__).resolve().parents[1]
SCRIPT="/workspace/tests/blender_modal_benchmark.py"
COMMAND=("blender","-b","--factory-startup","--python",SCRIPT)
CPU_CORES=2.0
MEMORY_MIB=4096
JOB_TIMEOUT=180
# November 2026 Modal list prices; illustrative, not the actual Modal bill.
FUNCTION_CPU_USD=0.00001310
FUNCTION_GIB_USD=0.00000222
SANDBOX_CPU_USD=0.00003942
SANDBOX_GIB_USD=0.00000667

image=modal.Image.from_dockerfile(str(REPOSITORY/"Dockerfile"),context_dir=str(REPOSITORY))
app=modal.App("blender-workspace-function-sandbox-comparison")

@app.function(image=image,cpu=CPU_CORES,memory=MEMORY_MIB,timeout=JOB_TIMEOUT,
              block_network=True,restrict_modal_access=True,
              single_use_containers=True)
def benchmark_function():
    started=time.perf_counter()
    run=subprocess.run(COMMAND,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                       text=True,timeout=JOB_TIMEOUT-10,check=False)
    if run.returncode!=0:
        raise RuntimeError("Blender Function returned "+str(run.returncode)+": "+run.stdout[-3000:])
    return {"log":run.stdout,"function_inner_seconds":time.perf_counter()-started}

def benchmark_sandbox():
    started=time.perf_counter()
    sb=modal.Sandbox.create(*COMMAND,app=app,image=image,cpu=CPU_CORES,
                            memory=MEMORY_MIB,timeout=JOB_TIMEOUT,
                            block_network=True)
    try:
        output=sb.stdout.read()
        exit_code=sb.wait()
        total=time.perf_counter()-started
        if exit_code!=0:
            error=sb.stderr.read()
            raise RuntimeError("Blender Sandbox exited "+str(exit_code)+": "+(output+error)[-3000:])
        return {"log":output,"elapsed_seconds":total}
    finally:
        sb.terminate()

def summary_from_log(log):
    lines=[line.removeprefix("BW_MODAL_BENCH_RESULT ") for line in log.splitlines()
           if line.startswith("BW_MODAL_BENCH_RESULT ")]
    if len(lines)!=1:
        raise RuntimeError("Missing or duplicate Blender measurement marker")
    values=json.loads(lines[0])
    for key in ("mesh_objects","vertices","polygons","glb_bytes"):
        if not isinstance(values.get(key),int) or values[key]<=0:
            raise ValueError("Invalid Blender output: "+key)
    if not isinstance(values.get("blender_seconds"),(int,float)):
        raise ValueError("Blender duration missing")
    return values

def estimate_cost(seconds,kind):
    # Upper-style reservation estimate; real Modal bill depends on utilization.
    cpu=FUNCTION_CPU_USD if kind=="function" else SANDBOX_CPU_USD
    ram=FUNCTION_GIB_USD if kind=="function" else SANDBOX_GIB_USD
    return seconds*(CPU_CORES*cpu+(MEMORY_MIB/1024)*ram)

def experiment(iterations):
    observations=[]
    with app.run():
        # Image build, Modal startup cache and SDK handshake are excluded
        # from samples by running one explicit (billable) warm-up of each kind.
        function_warmup=benchmark_function.remote()
        summary_from_log(function_warmup["log"])
        sandbox_warmup=benchmark_sandbox()
        summary_from_log(sandbox_warmup["log"])
        for n in range(iterations):
            # Alternate ordering to reduce systematic first/second effects.
            order=("function","sandbox") if n%2==0 else ("sandbox","function")
            for kind in order:
                started=time.perf_counter()
                if kind=="function":
                    result=benchmark_function.remote()
                    elapsed=time.perf_counter()-started
                else:
                    result=benchmark_sandbox()
                    elapsed=result["elapsed_seconds"]
                geometry=summary_from_log(result["log"])
                observations.append({
                    "iteration":n+1,"kind":kind,
                    "client_wall_seconds":round(elapsed,6),
                    "blender_seconds":geometry["blender_seconds"],
                    "startup_and_transport_seconds":round(max(0,elapsed-geometry["blender_seconds"]),6),
                    "mesh_objects":geometry["mesh_objects"],
                    "vertices":geometry["vertices"],
                    "polygons":geometry["polygons"],
                    "glb_bytes":geometry["glb_bytes"],
                    "estimated_usd_at_reserved_resources":round(estimate_cost(elapsed,kind),8)
                })
    geometry=[(v["mesh_objects"],v["vertices"],v["polygons"]) for v in observations]
    if len(set(geometry))!=1:
        raise RuntimeError("Function and Sandbox workloads returned different mesh geometry")
    metrics={}
    for kind in ("function","sandbox"):
        subset=[o for o in observations if o["kind"]==kind]
        metrics[kind]={
            "median_client_wall_seconds":round(statistics.median(x["client_wall_seconds"] for x in subset),4),
            "median_blender_seconds":round(statistics.median(x["blender_seconds"] for x in subset),4),
            "median_startup_and_transport_seconds":round(statistics.median(x["startup_and_transport_seconds"] for x in subset),4),
            "total_estimated_usd_samples_only":round(sum(x["estimated_usd_at_reserved_resources"] for x in subset),6)
        }
    return {"utc":datetime.now(timezone.utc).isoformat(),"iterations_per_mode":iterations,
            "warmups_per_mode":1,"cpu_cores_requested":CPU_CORES,"memory_mib_requested":MEMORY_MIB,
            "network_blocked_both":True,"secrets_mounted":False,
            "same_blender_docker_image":True,"observations":observations,
            "medians":metrics,
            "cost_note":"Estimate only; excludes warmups, image build and actual dynamic utilization. Verify in Modal billing."}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute",action="store_true",help="Explicitly permit paid Modal calls")
    parser.add_argument("--iterations",type=int,default=3,choices=range(1,6),metavar="1-5")
    parser.add_argument("--output",default="modal-benchmark-results.json")
    args=parser.parse_args()
    scenario_cost=2*(1+args.iterations)*JOB_TIMEOUT*(
        CPU_CORES*SANDBOX_CPU_USD+MEMORY_MIB/1024*SANDBOX_GIB_USD)
    if not args.execute:
        print("DRY RUN: no Modal resources were started.")
        print(f"Iterations: {args.iterations} + one warmup per mode; timeout {JOB_TIMEOUT}s")
        print(f"Illustrative upper-reservation scenario (not a hard budget): ${scenario_cost:.3f}")
        print("Execute explicitly using --execute after verifying your Modal account budget.")
        return
    result=experiment(args.iterations)
    output=Path(args.output)
    output.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps(result["medians"],indent=2))
    print("Results saved to",output.resolve())

if __name__=="__main__":
    main()
