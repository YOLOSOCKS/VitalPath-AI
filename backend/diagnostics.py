import os
import requests
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

def check_system():
    print("--- VitalPath AI SYSTEM DIAGNOSTICS ---")
    
    # 1. Check Gemini
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        try:
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel('gemini-2.5-flash')
            response = model.generate_content("Health check: System Online.")
            print(f"[OK] Gemini API: Connected. Response: {response.text[:20]}...")
        except Exception as e:
            print(f"[ERROR] Gemini API: {e}")
    else:
        print("[FAIL] Gemini API: Key missing in .env")

    # 2. Check ElevenLabs
    el_key = os.getenv("ELEVENLABS_API_KEY")
    if el_key:
        url = "https://api.elevenlabs.io/v1/text-to-speech/1HQIcT8WUDvJ4s708iUm"
        headers = {"xi-api-key": el_key}
        # Try to speak just one word to verify the key works
        response = requests.post(url, json={"text": "test", "model_id": "eleven_flash_v2_5"}, headers=headers)
        if response.status_code == 200:
            print("[OK] ElevenLabs API: Key Active and Credits Available.")
        else:
            print(f"[FAIL] ElevenLabs API: {response.status_code} - {response.text}")

if __name__ == "__main__":
    check_system()