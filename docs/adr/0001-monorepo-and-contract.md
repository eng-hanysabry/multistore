# ADR 0001: one repository, two independent projects, contract as the only link
Status: accepted (spec v4.9, section 3, approved baseline). No shared source code, separate lockfiles and pipelines, `contracts/openapi.json` generated from code with a CI freshness check. Either project can move to its own repository by copying its folder and workflow.
