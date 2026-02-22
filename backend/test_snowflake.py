import snowflake.connector
from cryptography.hazmat.primitives import serialization

try:
    print("Loading private key...")
    PRIVATE_KEY_PATH = r"C:\Users\thisb\VitalPath\VitalPath-AI\backend\snowflake_private_key.p8"
    with open(PRIVATE_KEY_PATH, "rb") as key_file:
        p_key = serialization.load_pem_private_key(
            key_file.read(),
            password=None,
        )
    private_key_bytes = p_key.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    print("Connecting to Snowflake...")
    conn = snowflake.connector.connect(
        user="TMONEY05",
        account="BPTPMBF-MY80898",
        warehouse="YOUR_WAREHOUSE",
        database="YOUR_DATABASE",
        schema="YOUR_SCHEMA",
        role="ACCOUNTADMIN",
        private_key=private_key_bytes,
    )

    print("Connected! Running test query...")
    cur = conn.cursor()
    cur.execute("SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_ACCOUNT();")
    result = cur.fetchone()
    print("RESULT:", result)
    cur.close()
    conn.close()
    print("Done.")
except Exception as e:
    print("ERROR:", e)