
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const respond = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/api/health") {
      return respond({
        success: true,
        message: "Risen Education AI Worker is running."
      });
    }

    if (url.pathname === "/api/generate-material" && request.method === "POST") {
      try {
        const body = await request.json();
        const { subject, chapter, sourceText, task } = body;

        if (!subject || !chapter || !sourceText) {
          return respond({
            success: false,
            error: "Subject, chapter and sourceText are required."
          }, 400);
        }

        const prompt = `
You are an educational assistant for The Risen High School.

Create accurate educational material using ONLY the supplied textbook content.
Do not invent textbook facts. If information is missing, say so.
Use clear Urdu when requested and age-appropriate explanations.

Subject: ${subject}
Chapter: ${chapter}
Task: ${task || "Create notes and questions"}

Textbook content:
${String(sourceText).slice(0, 12000)}
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            prompt,
            max_tokens: 1800
          }
        );

        return respond({
          success: true,
          result: result.response || result
        });

      } catch (error) {
        return respond({
          success: false,
          error: "Material generation failed.",
          detail: error.message
        }, 500);
      }
    }

    return respond({
      success: false,
      error: "API route not found."
    }, 404);
  }
};
