import { cashierScenario } from "./scenarios/cashier.js";
import { todoApiScenario } from "./scenarios/todo-api.js";
import { urlShortenerScenario } from "./scenarios/url-shortener.js";
import { blogCmsScenario } from "./scenarios/blog-cms.js";
import { rateLimiterScenario } from "./scenarios/rate-limiter.js";
import { csvParserScenario } from "./scenarios/csv-parser.js";
import { weatherCacheScenario } from "./scenarios/weather-cache.js";
import { eventSchedulerScenario } from "./scenarios/event-scheduler.js";
import { inventoryWmsScenario } from "./scenarios/inventory-wms.js";
import { authJwtScenario } from "./scenarios/auth-jwt.js";
import type { AgentTaskScenario } from "./types.js";

export * from "./types.js";

/** Ten diverse agent coding tasks used to prove TokensCache cache savings. */
export const ALL_AGENT_TASKS: AgentTaskScenario[] = [
  cashierScenario,
  todoApiScenario,
  urlShortenerScenario,
  blogCmsScenario,
  rateLimiterScenario,
  csvParserScenario,
  weatherCacheScenario,
  eventSchedulerScenario,
  inventoryWmsScenario,
  authJwtScenario,
];

export const AGENT_TASK_IDS = ALL_AGENT_TASKS.map((t) => t.id);
