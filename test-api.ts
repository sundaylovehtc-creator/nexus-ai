import { makeOpenRouterProvider } from '../packages/runtime/src/openrouter-provider.ts';

async function test() {
  console.log('Testing OpenRouter API...');
  const provider = makeOpenRouterProvider({
    apiKey: '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',
    defaultModel: 'google/gemma-3-12b-it:free',
  });

  const messages = [
    { id: '1', role: 'user', content: 'Say hello in exactly 3 words', timestamp: Date.now() }
  ];

  const result = await provider.generate(messages, { maxTokens: 50 });
  console.log('✅ API Success!');
  console.log('Response:', result.content);
  console.log('Model:', result.model);
  console.log('Usage:', result.usage);
}

test().catch(e => console.error('❌ Error:', e.message));
