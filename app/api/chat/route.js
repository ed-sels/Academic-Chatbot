import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY
});

// Default models
const PRIMARY_MODEL = process.env.NEXT_PUBLIC_GROQ_MODEL || "llama3-70b-8192";
const FALLBACK_MODEL = process.env.NEXT_PUBLIC_GROQ_MODEL_FALLBACK || "llama3-8b-8192-instruct";

const systemPrompt =
  "You are a friendly and knowledgeable academic assistant, " +
  "coding assistant and a teacher of anything related to AI and Machine Learning. " +
  "Your role is to help users with anything related to academics, " +
  "provide detailed explanations, and support learning across various domains.";

export async function POST(request) {
  try {
    const { messages, msg } = await request.json();

    // Safely process incoming messages
    const processedMessages = messages && Array.isArray(messages)
      ? messages.reduce((acc, m) => {
          if (m && m.parts && m.parts[0] && m.parts[0].text) {
            acc.push({
              role: m.role === "model" ? "assistant" : "user",
              content: m.parts[0].text
            });
          }
          return acc;
        }, [])
      : [];

    // Include system prompt and current user message
    const enhancedMessages = [
      { role: "system", content: systemPrompt },
      ...processedMessages,
      { role: "user", content: msg }
    ];

    /**
     * Helper function to attempt streaming with fallback
     */
    const createStream = async (modelName) => {
      return groq.chat.completions.create({
        messages: enhancedMessages,
        model: modelName,
        stream: true,
        max_tokens: 1024,
        temperature: 0.7,
      });
    };

    let stream;
    try {
      // Try primary model first
      stream = await createStream(PRIMARY_MODEL);
    } catch (primaryError) {
      console.warn(`Primary model (${PRIMARY_MODEL}) failed:`, primaryError.message);

      // Try fallback model
      try {
        console.log(`Falling back to model: ${FALLBACK_MODEL}`);
        stream = await createStream(FALLBACK_MODEL);
      } catch (fallbackError) {
        console.error(`Fallback model (${FALLBACK_MODEL}) also failed:`, fallbackError.message);
        throw new Error("Both primary and fallback models failed.");
      }
    }

    // Convert streaming response to a readable stream
    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(responseStream);

  } catch (error) {
    console.error("Error in chat API:", error);
    return new Response(
      JSON.stringify({
        error: "An error occurred processing your request",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
