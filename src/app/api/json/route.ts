import { NextRequest, NextResponse } from "next/server";
import { z, ZodTypeAny } from "zod";
import { replicate } from "@/lib/replicate";
import { EXAMPLE_ANSWER } from "./example";

const determineSchemaType = (schema: any): string => {
  if (!schema.hasOwnProperty("type")) {
    if (Array.isArray(schema)) {
      return "array"
    } else {
      return typeof schema
    }
  }
  return schema.type
}

const jsonSchemaToZod = (schema: any): any => {
  const type = determineSchemaType(schema)

  switch (type) {
    case "string":
      return z.string().nullable()
    case "number":
      return z.number().nullable()
    case "boolean":
      return z.boolean().nullable()
    case "array":
      return z.array(jsonSchemaToZod(schema.items)).nullable()
    case "object":
      const shape: Record<string, any> = {}
      for (const key in schema) {
        if (key !== "type") {
          shape[key] = jsonSchemaToZod(schema[key])
        }
      }
      return z.object(shape)
    default:
      throw new Error(`Unsupported schema type: ${type}`)
  }
}

type PromiseExecutor<T> = (
  resolve: (value: T) => void,
  reject: (reason?: any) => void
) => void

class RetryablePromise<T> extends Promise<T> {
  static async retry<T>(
    retries: number,
    executor: PromiseExecutor<T>
  ): Promise<T> {
    return new RetryablePromise<T>(executor).catch((error) => {
      console.error(`Retrying due to error: ${error}`)
      return retries > 0
        ? RetryablePromise.retry(retries - 1, executor)
        : RetryablePromise.reject(error)
    })
  }
}

export const POST = async (req: NextRequest) => {
  const body = await req.json();

  const genericSchema = z.object({
    data: z.string(),
    format: z.object({}).passthrough() || z.string().optional(),
  });

  const { data, format } = genericSchema.parse(body);


  const dynamicSchema = jsonSchemaToZod(format);

  const content = `DATA: \n"${data}"\n\n-----------\nExpected JSON format: 
  ${JSON.stringify(format, null, 2)}
  \n\n-----------\nValid JSON output in expected example format:
  ${EXAMPLE_ANSWER}
  `

  const validatonResult = await RetryablePromise.retry<string>(
    3,
   async (resolve, reject) => {
      try {

        const input = {
          top_k: 0,
          top_p: 1,
          prompt: content,
          temperature: 0.5,
          system_prompt: "You are a helpful AI that converts data into the attached JSON format. You respond with nothing but valid JSON based on input data. Your output should direclty be the JSON, nothing added before or after. You will begin with opening curly braces and end with closing curly braces. Only if you absolutely cannot determine a field, use value null.",

          length_penalty: 1,
          max_new_tokens: 500,
          min_new_tokens: -1,
          prompt_template: "<s>[INST] <<SYS>>{system_prompt}<</SYS>>{prompt} [/INST]",
          presence_penalty: 0
        };

        const text = await replicate.run("meta/llama-2-70b-chat", {input})
          // @ts-ignore
        const validationResult = text.join("")  
          console.log(JSON.parse(validationResult))
        return resolve(JSON.parse(validationResult))

      } catch (error) {
        reject(error);
      }
    }
  );

  return NextResponse.json(validatonResult, { status: 200 });
};
