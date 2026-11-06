#!/usr/bin/env bash
# Kiểm tra phân tích null của Eclipse JDT (cùng cấu hình mà VS Code/Eclipse dùng trong
# backend/.settings/org.eclipse.jdt.core.prefs) ở chế độ headless bằng ECJ độc lập,
# biên dịch main + test trong MỘT lượt từ source như IDE. Maven gate (javac + SpotBugs)
# không chạy phân tích này, nên cảnh báo null chỉ lộ ra trong IDE; script này giúp tái
# hiện và chặn chúng ngoài IDE.
#
# Cách chạy:  infra/check-null-analysis.sh
# Yêu cầu: JDK 25 (JAVA_HOME), Maven wrapper của backend, python3. Lần chạy đầu cần
# mạng để tải ECJ về local repository; các lần sau chạy offline.
# Biến môi trường tuỳ chọn: MVN_SETTINGS (đường dẫn settings.xml riêng cho Maven).
#
# Mã thoát: 0 khi không còn cảnh báo thuộc họ null ngoài các điểm dung sai đã ghi dưới
# đây, 1 khi còn cảnh báo mới, 2 khi thiếu công cụ.
#
# CÁC ĐIỂM DUNG SAI (có bằng chứng, không phải suppression): cả ba đều cùng một gốc —
# ECJ 3.44 đọc sai annotation org.jspecify.annotations.Nullable trên type của thư viện
# đã biên dịch (bytecode) khi type nằm trong gói @NullMarked:
# 1. JdbcOidcSessionRegistry.removeSessionInformation(String): interface
#    OidcSessionRegistry của Spring Security 7 khai báo giá trị trả về là @Nullable
#    trong bytecode (kiểm chứng bằng javap), nhưng ECJ đọc thành @NonNull nên báo
#    IllegalReturnNullityRedefinition dù annotation phía ghi đè là đúng đặc tả và
#    method thật sự trả null khi không có dòng nào bị xoá.
# 2. KeycloakDecisionClientTest và PolicyGraphWriterNativeIT gọi
#    UsernamePasswordAuthenticationToken.authenticated(principal, null, authorities):
#    tham số credentials là @Nullable trong bytecode của Spring Security 7 (kiểm
#    chứng bằng javap), nhưng ECJ vẫn báo RequiredNonNullButProvidedNull khi truyền
#    null; cả hai trường hợp đều tái hiện được bằng chương trình tối thiểu.
# Khi ECJ sửa cách đọc này, các điểm dung sai tự hết hiệu lực (script vẫn thoát 0).
set -uo pipefail

ECJ_VERSION="3.44.0"
DEPENDENCY_PLUGIN="org.apache.maven.plugins:maven-dependency-plugin:3.10.0"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
PREFS="$BACKEND/.settings/org.eclipse.jdt.core.prefs"
MVNW="$BACKEND/mvnw"
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}java"

command -v python3 >/dev/null || {
    echo "Thiếu python3." >&2
    exit 2
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MVN_ARGS=(-B -ntp)
if [ -n "${MVN_SETTINGS:-}" ]; then
    MVN_ARGS+=(-s "$MVN_SETTINGS")
fi

# Lấy ECJ vào thư mục tạm qua Maven (dùng lại local repository nếu đã có).
(cd "$BACKEND" && "$MVNW" "${MVN_ARGS[@]}" "$DEPENDENCY_PLUGIN:copy" \
    -Dartifact="org.eclipse.jdt:ecj:$ECJ_VERSION" -DoutputDirectory="$WORK" -q) || {
    echo "Không lấy được ECJ $ECJ_VERSION qua Maven." >&2
    exit 2
}
ECJ_JAR="$WORK/ecj-$ECJ_VERSION.jar"

# Classpath đầy đủ (gồm test scope) của backend.
(cd "$BACKEND" && "$MVNW" "${MVN_ARGS[@]}" "$DEPENDENCY_PLUGIN:build-classpath" \
    -Dmdep.outputFile="$WORK/cp.txt" -q) || {
    echo "Không dựng được classpath của backend." >&2
    exit 2
}
CP="$(cat "$WORK/cp.txt")"

mkdir -p "$WORK/out"
# ECJ thoát khác 0 khi có problem (kể cả problem ngoài họ null đã tồn tại từ trước);
# kết luận chỉ dựa trên log XML nên bỏ qua mã thoát ở lần chạy này.
(cd "$BACKEND" && "$JAVA_BIN" -jar "$ECJ_JAR" -properties "$PREFS" -proc:none \
    -maxProblems 10000 -cp "$CP" -d "$WORK/out" -log "$WORK/all.xml" \
    src/main/java src/test/java >/dev/null 2>&1) || true

python3 - "$WORK" <<'PYEOF'
import sys
import xml.etree.ElementTree as ET

work = sys.argv[1]
NULL_KEYS = {
    "org.eclipse.jdt.core.compiler.problem.nullSpecViolation",
    "org.eclipse.jdt.core.compiler.problem.potentialNullReference",
    "org.eclipse.jdt.core.compiler.problem.nullReference",
    "org.eclipse.jdt.core.compiler.problem.nullAnnotationInferenceConflict",
    "org.eclipse.jdt.core.compiler.problem.redundantNullCheck",
    "org.eclipse.jdt.core.compiler.problem.unusedNullAnnotation",
    "org.eclipse.jdt.core.compiler.problem.nonnullParameterAnnotationDropped",
}
UNCHECKED_KEY = "org.eclipse.jdt.core.compiler.problem.nullUncheckedConversion"
# Các điểm dung sai, lý do đã ghi ở đầu script: (hậu tố đường dẫn, id problem, số lần tối đa).
TOLERATED = [
    ("identity/security/JdbcOidcSessionRegistry.java", "IllegalReturnNullityRedefinition", 1),
    ("authorization/decision/KeycloakDecisionClientTest.java", "RequiredNonNullButProvidedNull", 1),
    ("authorization/policy/PolicyGraphWriterNativeIT.java", "RequiredNonNullButProvidedNull", 1),
]

tolerated_counts = [0] * len(TOLERATED)
failures = []
unchecked = 0
tree = ET.parse(f"{work}/all.xml")
for source in tree.getroot().iter("source"):
    path = source.get("path")
    for problem in source.iter("problem"):
        key = problem.get("optionKey")
        if key == UNCHECKED_KEY:
            unchecked += 1
            continue
        if key not in NULL_KEYS:
            continue
        for i, (suffix, pid, _max) in enumerate(TOLERATED):
            if path.endswith(suffix) and problem.get("id") == pid:
                tolerated_counts[i] += 1
                break
        else:
            failures.append(
                f"{path}:{problem.get('line')}: "
                f"{key.rsplit('.', 1)[-1]} [{problem.get('id')}]"
            )

for i, (suffix, pid, maximum) in enumerate(TOLERATED):
    if tolerated_counts[i] > maximum:
        failures.append(
            f"{suffix}: điểm dung sai {pid} xuất hiện {tolerated_counts[i]} lần, "
            f"nhiều hơn mức tối đa {maximum} đã ghi nhận"
        )

for failure in sorted(failures):
    print(failure)
print(
    f"Cảnh báo họ null ngoài dung sai: {len(failures)}; "
    f"trong dung sai: {sum(tolerated_counts)}; "
    f"unchecked conversion (chỉ thông tin, ngoài họ null): {unchecked}"
)
sys.exit(1 if failures else 0)
PYEOF
