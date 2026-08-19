#!/usr/bin/env bash
# Erzeugt die GPG-Interop-Testvektoren in fixtures/gpg/.
#
# ⚠️ Die hier entstehenden privaten Schluessel sind WEGWERF-TESTSCHLUESSEL mit
#    oeffentlich bekannter Passphrase. Sie gehoeren ins Repo, damit die Tests
#    ueberall laufen. Sie duerfen NIE fuer echte Kommunikation benutzt werden.
#
# Der Keyring liegt in einem eigenen GNUPGHOME und wird danach geloescht — das
# Skript fasst deinen echten Keyring nicht an.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/fixtures/gpg"
export GNUPGHOME="$ROOT/fixtures/.gnupg"
PASS="klartext-fixture-passphrase"

command -v gpg >/dev/null || { echo "gpg fehlt: brew install gnupg" >&2; exit 1; }

# ⚠️ Ohne feste Locale schreibt gpg den Vorspann des Widerrufszertifikats in der
#    Sprache des Erzeugers — die Fixture saehe auf jedem Rechner anders aus.
export LC_ALL=C LANG=C

rm -rf "$GNUPGHOME" "$OUT"
mkdir -p "$GNUPGHOME" "$OUT"
chmod 700 "$GNUPGHOME"

g() { gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" "$@"; }

echo "gpg: $(gpg --version | head -1)"

# --- Schluessel -------------------------------------------------------------
# Bewusst ueber Parameterdateien statt --quick-generate-key: letzteres legt nur
# den Primaerschluessel an, ohne Verschluesselungs-Subkey ("Unbrauchbarer
# oeffentlicher Schluessel" beim ersten Verschlusselungsversuch).
# Beide Schluessel sind v4 — das ist die Zielkompatibilitaet (GnuPG >= 2.1).
gen_key() {
  local params; params="$(mktemp)"
  cat > "$params"
  gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" --generate-key "$params"
  rm -f "$params"
}

gen_key <<PARAMS
Key-Type: RSA
Key-Length: 4096
Key-Usage: sign,cert
Subkey-Type: RSA
Subkey-Length: 4096
Subkey-Usage: encrypt
Name-Real: Klartext RSA Fixture
Name-Email: rsa@fixture.klartext.invalid
Expire-Date: 0
Passphrase: $PASS
%commit
PARAMS

gen_key <<PARAMS
Key-Type: EDDSA
Key-Curve: Ed25519
Key-Usage: sign,cert
Subkey-Type: ECDH
Subkey-Curve: Curve25519
Subkey-Usage: encrypt
Name-Real: Klartext ECC Fixture
Name-Email: ecc@fixture.klartext.invalid
Expire-Date: 0
Passphrase: $PASS
%commit
PARAMS

RSA_FPR=$(gpg --batch --with-colons --list-keys rsa@fixture.klartext.invalid | awk -F: '/^fpr:/{print $10; exit}')
ECC_FPR=$(gpg --batch --with-colons --list-keys ecc@fixture.klartext.invalid | awk -F: '/^fpr:/{print $10; exit}')
echo "RSA  $RSA_FPR"
echo "ECC  $ECC_FPR"

g --armor --export        "$RSA_FPR" > "$OUT/rsa4096.pub.asc"
g --armor --export-secret-key "$RSA_FPR" > "$OUT/rsa4096.sec.asc"
g --armor --export        "$ECC_FPR" > "$OUT/ed25519.pub.asc"
g --armor --export-secret-key "$ECC_FPR" > "$OUT/ed25519.sec.asc"

# --- Nachrichten ------------------------------------------------------------
printf 'Hallo aus GnuPG.\nZeile zwei mit Umlauten: Grueezi, Aepfel, weisse Woelfe.\n' > "$OUT/plaintext.txt"

# verschluesselt an RSA (nur verschluesselt)
g --armor --trust-model always --recipient "$RSA_FPR" --output "$OUT/msg.rsa.enc.asc" --encrypt "$OUT/plaintext.txt"
# verschluesselt an ECC
g --armor --trust-model always --recipient "$ECC_FPR" --output "$OUT/msg.ecc.enc.asc" --encrypt "$OUT/plaintext.txt"
# verschluesselt UND signiert (an RSA, signiert von RSA)
g --armor --trust-model always --recipient "$RSA_FPR" --local-user "$RSA_FPR" \
  --output "$OUT/msg.rsa.signed-enc.asc" --sign --encrypt "$OUT/plaintext.txt"
# an BEIDE Empfaenger — deckt den Gruppenfall aus Phase 4 ab
g --armor --trust-model always --recipient "$RSA_FPR" --recipient "$ECC_FPR" \
  --output "$OUT/msg.both.enc.asc" --encrypt "$OUT/plaintext.txt"

# --- Signaturen -------------------------------------------------------------
g --armor --local-user "$RSA_FPR" --output "$OUT/sig.rsa.clear.asc"    --clearsign        "$OUT/plaintext.txt"
g --armor --local-user "$RSA_FPR" --output "$OUT/sig.rsa.detached.asc" --detach-sign      "$OUT/plaintext.txt"
g --armor --local-user "$ECC_FPR" --output "$OUT/sig.ecc.detached.asc" --detach-sign      "$OUT/plaintext.txt"

# --- Widerrufszertifikat ----------------------------------------------------
# gpg legt es bei der Erzeugung automatisch unter openpgp-revocs.d ab.
cp "$GNUPGHOME/openpgp-revocs.d/$RSA_FPR.rev" "$OUT/rsa4096.revoke.asc"

# --- Metadaten fuer die Tests ----------------------------------------------
cat > "$OUT/meta.json" <<META
{
  "erzeugtMit": "$(gpg --version | head -1)",
  "passphrase": "$PASS",
  "hinweis": "WEGWERF-TESTSCHLUESSEL. Passphrase absichtlich oeffentlich. Nie fuer echte Kommunikation verwenden.",
  "rsa": { "fingerprint": "$RSA_FPR", "userId": "Klartext RSA Fixture <rsa@fixture.klartext.invalid>" },
  "ecc": { "fingerprint": "$ECC_FPR", "userId": "Klartext ECC Fixture <ecc@fixture.klartext.invalid>" },
  "klartext": "Hallo aus GnuPG.\\nZeile zwei mit Umlauten: Grueezi, Aepfel, weisse Woelfe.\\n"
}
META

gpgconf --kill gpg-agent 2>/dev/null || true
rm -rf "$GNUPGHOME"

echo
echo "Fixtures in fixtures/gpg/:"
ls -1 "$OUT"
