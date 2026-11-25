import { defineSystem, onUpdate, useQuery, useService } from "@gwenjs/core/system";

export const Shadow = defineSystem("Shadow", () => {
  function useService() {}
  const useQuery = () => [];
  onUpdate(() => {
    useService();
    useQuery();
  });
});

export const Anchor = defineSystem("Anchor", () => {
  useQuery([]);
  onUpdate(() => {
    useService("anchor");
  });
});
