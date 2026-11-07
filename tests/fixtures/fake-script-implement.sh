# Simulates an implementer: writes code for the call it is on ($1 = seat, $2 = call number).
[[ "$1" == "implementer" ]] || exit 0
echo "implemented by call $2" > "feature-$2.txt"
