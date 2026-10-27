/**
 * Minimal typings for the slice of the PayPal JS SDK v6 this app uses.
 * The v6 `web-sdk/v6/core` global ships no types of its own.
 */
export type PayPalOneTimePaymentSession = {
  start(
    options: { presentationMode: 'auto' | 'modal' | 'popup' | 'payment-handler' },
    order: Promise<{ orderId: string }>,
  ): Promise<void>;
};

export type PayPalSdkInstance = {
  findEligibleMethods(options: {
    currencyCode: string;
  }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(handlers: {
    onApprove(data: { orderId: string }): void | Promise<void>;
    onCancel?(data: unknown): void;
    onError?(error: unknown): void;
  }): PayPalOneTimePaymentSession;
};

export type PayPalGlobal = {
  createInstance(options: {
    clientToken: string;
    components?: string[];
    pageType?: string;
    locale?: string;
  }): Promise<PayPalSdkInstance>;
};

declare global {
  interface Window {
    paypal?: PayPalGlobal;
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'paypal-button': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { type?: string };
    }
  }
}
