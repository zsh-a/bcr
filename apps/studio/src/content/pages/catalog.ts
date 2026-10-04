import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { componentProps as props } from "./model";

export const pageCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: props.Stack,
      slots: ["default"],
      description: "Vertical layout with consistent spacing",
    },
    Columns: {
      props: props.Columns,
      slots: ["default"],
      description: "Responsive two or three column layout",
    },
    Heading: { props: props.Heading, description: "Page or section heading" },
    Text: {
      props: props.Text,
      description: "Editable text; model and reviewedRun bind a claim to a calculation version",
    },
    Metric: {
      props: props.Metric,
      description: "A decimal result from a model output; scenario defaults to base",
    },
    Parameter: {
      props: props.Parameter,
      description: "Editable model parameter, with a local sensitivity slider when configured",
    },
    Chart: {
      props: props.Chart,
      description: "Same-unit outputs; bar compares scenarios, line uses model sweep",
    },
    Table: { props: props.Table, description: "Exact decimal outputs and units across scenarios" },
    Sources: {
      props: props.Sources,
      description: "Project evidence with external URLs, dates and scope",
    },
  },
  actions: {},
});
