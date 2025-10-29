declare module "braintree-web-drop-in" {
  type PayPalFlow = "checkout" | "vault";

  export interface DropinRequestPaymentMethodPayload {
    nonce: string;
    type?: string;
    details?: unknown;
  }

  export interface DropinInstance {
    requestPaymentMethod(): Promise<DropinRequestPaymentMethodPayload>;
    teardown(): Promise<void>;
    isPaymentMethodRequestable?: boolean;
    on?(event: string, handler: (...args: any[]) => void): void;
  }

  export interface DropinCreateOptions {
    authorization: string;
    container: HTMLElement | string;
    card?: false | Record<string, any>;
    paypal?: { flow: PayPalFlow; amount?: string; currency?: string };
    vaultManager?: boolean;
    locale?: string;
  }

  function create(options: DropinCreateOptions): Promise<DropinInstance>;

  const dropin: { create: typeof create };
  export default dropin;
}
