import { createFileRoute } from "@tanstack/react-router";
import SharkyPizzaRun from "@/games/SharkyPizzaRun";

export const Route = createFileRoute("/games/pizza-run")({
  head: () => ({
    meta: [
      { title: "Sharky Pizza Run — Livre des pizzas en scooter" },
      { name: "description", content: "Aide Sharky à livrer des pizzas dans la ville. Esquive les obstacles, collecte les pizzas et livre aux clients avant la fin du temps !" },
    ],
  }),
  component: SharkyPizzaRun,
});
