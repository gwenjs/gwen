import { withAsyncContext } from "@gwenjs/core";

withAsyncContext(async () => {
  await work(/*@map*/ mark);
});
