/**
 * ModelGate — Middleware Pipeline
 *
 * Composable, Express/Koa-style middleware system that wraps
 * chat/stream calls. Implements the classic "onion model" where
 * each middleware can modify the request before calling next()
 * and modify the response after next() returns.
 */

import type { Middleware, RequestContext, ResponseContext } from "../types.js";

export class MiddlewarePipeline {
  private middlewares: Middleware[] = [];

  /** Add a middleware to the pipeline. Returns `this` for chaining. */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Execute the pipeline with a request context and final handler.
   *
   * Builds a chain where each middleware calls `next()` to proceed
   * to the next middleware, and the last `next()` calls `finalHandler`.
   *
   * Key behaviors:
   * - Middlewares run in registration order
   * - Each can modify `ctx` before calling `next()`
   * - Each can modify the response after `next()` returns
   * - If a middleware doesn't call `next()`, it short-circuits
   * - Errors propagate up through the chain
   */
  async execute(
    ctx: RequestContext,
    finalHandler: (ctx: RequestContext) => Promise<ResponseContext>,
  ): Promise<ResponseContext> {
    const dispatch = (i: number): Promise<ResponseContext> => {
      if (i >= this.middlewares.length) {
        // End of the chain — call the final handler
        return finalHandler(ctx);
      }

      const middleware = this.middlewares[i];
      return middleware(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  }
}
