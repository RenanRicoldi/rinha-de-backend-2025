import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import Fastify from "fastify";
import { request } from 'undici';

const api = Fastify({
  logger: true
});

await api.register(fastifySwagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Rinha de Backend',
      version: '1.0.0',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: 'Development server'
      }
    ]
  },
})

await api.register(fastifyCors, {
  allowedHeaders: '*',
  origin: '*'
})

interface IRequestBody {
  correlationId: string;
  amount: number;
  requestedAt: Date;
}

const defaultRequests: Array<IRequestBody> = [];
const fallbackRequests: Array<IRequestBody> = [];

api.post<{
  Body: {
    correlationId: string;
    amount: number;
  }
}>("/payments", {
  schema: {
    body: {
      type: "object",
      properties: {
        correlationId: { type: "string" },
        amount: { type: "number" },
      }
    }
  }
}, async (req, res) => {
  try {
    const body = { ...req.body, requestedAt: new Date().toISOString() };
    const result = await request(
      `${process.env.PAYMENT_PROCESSOR_URL_DEFAULT}/payments`, 
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
    );
    if(result.statusCode > 299)
      throw new Error(`Body: ${JSON.stringify(body)} | Status code: ${result.statusCode}`)
    const responseBody = JSON.stringify(await result.body.json());
    console.log("SUCCESS PROCESSING PAYMENT ON DEFAULT PROCESSOR", responseBody);
    defaultRequests.push({...body, requestedAt: new Date(body.requestedAt)});
    console.log(defaultRequests[defaultRequests.length - 1]);
  } catch(ex) {
    console.log("ERROR PROCESSING PAYMENT ON DEFAULT PROCESSOR", ex?.message);
    let success = false;
    let attempts = 0;
    while(!success)
    {
      if(attempts >= 10)
          return res.code(500).send({ success: false });
      try {
        attempts += 1;
        const body = { ...req.body, requestedAt: new Date().toISOString() };
        const result = await request(
          `${process.env.PAYMENT_PROCESSOR_URL_FALLBACK}/payments`,
          { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
        );
        if(result.statusCode > 299)
          throw new Error(`Body: ${JSON.stringify(body)} | Status code: ${result.statusCode}`)
        const responseBody = JSON.stringify(await result.body.json());
        console.log("SUCCESS PROCESSING PAYMENT ON FALLBACK PROCESSOR", responseBody);
        fallbackRequests.push({...body, requestedAt: new Date(body.requestedAt)});
        console.log(fallbackRequests[fallbackRequests.length - 1]);
        success = true;
      } catch (fallbackEx) {
        console.log("ERROR PROCESSING PAYMENT ON FALLBACK PROCESSOR", fallbackEx?.message);
      }
    }
  }

  return res.code(200).send({ success: true });
})

// GET /payments-summary?from=2020-07-10T12:34:56.000Z&to=2020-07-10T12:35:56.000Z
api.get<{
  Querystring: {
    from: string;
    to: string;
  }
}>("/payments-summary", {
  schema: {
    querystring: {
      type: "object",
      properties: {
        from: { type: 'string' },
        to: { type: 'string' }
      }
    }
  }
}, async (req, res) => {
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);

  return res.code(200).send({
    default: 
      defaultRequests.filter((val) => val.requestedAt > from && val.requestedAt < to).reduce(
        (prev, curr) => (
          {
            totalRequests: prev.totalRequests + 1,
            totalAmount: prev.totalAmount + curr.amount
          }
        ), 
        {
          totalRequests: 0,
          totalAmount: 0.0
        }
      ),
    fallback: 
      fallbackRequests.filter((val) => val.requestedAt > from && val.requestedAt < to).reduce(
        (prev, curr) => (
          {
            totalRequests: prev.totalRequests + 1,
            totalAmount: prev.totalAmount + curr.amount
          }
        ), 
        {
          totalRequests: 0,
          totalAmount: 0.0
        }
      )
  });
});

api.get('/openapi.json', async (request, reply) => {
  return api.swagger()
})

api.listen({
    port: Number(process.env.PORT) || 3000
})