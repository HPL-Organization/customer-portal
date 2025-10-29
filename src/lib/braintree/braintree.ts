import { BraintreeGateway, Environment } from "braintree";

const env =
  process.env.BRAINTREE_ENVIRONMENT === "production"
    ? Environment.Production
    : Environment.Sandbox;

export const gateway = new BraintreeGateway({
  environment: env,
  merchantId: process.env.BRAINTREE_MERCHANT_ID as string,
  publicKey: process.env.BRAINTREE_PUBLIC_KEY as string,
  privateKey: process.env.BRAINTREE_PRIVATE_KEY as string,
});
