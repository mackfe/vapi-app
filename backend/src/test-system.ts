import dotenv from 'dotenv';
import { AiPipeline } from './ai/Pipeline.js';
import { FishAudioClient } from './ai/FishAudioClient.js';
import fs from 'fs';

dotenv.config();

async function testSystem() {
  console.log('--- DIAGNÓSTICO DE SISTEMA DE IA ---');
  
  const keys = {
    GROQ: !!process.env.GROQ_API_KEY,
    DEEPGRAM: !!process.env.DEEPGRAM_API_KEY,
    FISHAUDIO: !!process.env.FISHAUDIO_API_KEY,
    FISH_REF: !!process.env.FISHAUDIO_REFERENCE_ID
  };
  
  console.log('Verificación de Variables de Entorno:');
  console.table(keys);

  const pipeline = new AiPipeline();
  const fish = new FishAudioClient();

  try {
    console.log('\n1. Probando Groq (Razonamiento)...');
    const response = await pipeline.getAiResponse('Hola, soy un vecino probando la línea. ¿Qué horario tienen?');
    console.log('✅ Groq respondió:', response);

    console.log('\n2. Probando FishAudio (Voz)...');
    const audioContent = await fish.textToSpeech(response.text);
    if (audioContent && audioContent.length > 0) {
      console.log(`✅ FishAudio generó un audio de ${audioContent.length} bytes.`);
      fs.writeFileSync('test-output.mp3', audioContent);
      console.log('   Audio guardado en test-output.mp3');
    }

    console.log('\n--- DIAGNÓSTICO COMPLETADO ---');
  } catch (err) {
    console.error('\n❌ ERROR DURANTE EL DIAGNÓSTICO:', err);
  }
}

testSystem();
