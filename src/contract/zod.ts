import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Single place where Zod gets the `.openapi()` extension; every contract module imports `z` from here.
extendZodWithOpenApi(z);

export { z };
