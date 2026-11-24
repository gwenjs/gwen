import { onEnter } from "@gwenjs/core/scene"

onEnter(async () => {
  await load(/*@map*/ mark)
  useEngine()
})
