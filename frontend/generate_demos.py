from gtts import gTTS
import os

demos = [
    ("alejandro", "Hola, soy Alejandro, tu asistente formal en español.", "es"),
    ("camila", "Hola! Soy Camila, ¿en qué te puedo ayudar hoy?", "es"),
    ("diego", "Qué tal, soy Diego. Estoy listo para asistirte.", "es"),
    ("sofia", "Hola, mi nombre es Sofía, asistente profesional.", "es"),
    ("john", "Hello, I am John, your professional assistant.", "en"),
    ("emma", "Hi there! I am Emma, how can I help you today?", "en")
]

os.makedirs("public/demos", exist_ok=True)

for name, text, lang in demos:
    tts = gTTS(text=text, lang=lang)
    tts.save(f"public/demos/{name}.mp3")
    print(f"Generated {name}.mp3")
