import Fastify from "fastify";
import { request } from 'undici';

const api = Fastify({
  logger: true
});

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
    await request(process.env.PAYMENT_PROCESSOR_URL_DEFAULT, { method: 'POST', body: JSON.stringify(body) });
    defaultRequests.push({...body, requestedAt: new Date(body.requestedAt)});
  } catch(ex) {
    console.log("ERROR PROCESSING PAYMENT ON DEFAULT PROCESSOR", ex?.message);
    let success = false;
    while(!success)
    {
      try {
        const body = { ...req.body, requestedAt: new Date().toISOString() };
        await request(process.env.PAYMENT_PROCESSOR_URL_FALLBACK, { method: 'POST', body: JSON.stringify(body) });
        fallbackRequests.push({...body, requestedAt: new Date(body.requestedAt)});
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

api.listen({
    port: Number(process.env.PORT) || 3000
})
