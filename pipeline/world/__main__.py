import sys

from pipeline.world.build import build_world, verify

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "build"
    if command == "build":
        build_world()
    elif command == "verify":
        sys.exit(0 if verify() else 1)
    else:
        sys.exit("usage: python -m pipeline.world [build|verify]")
