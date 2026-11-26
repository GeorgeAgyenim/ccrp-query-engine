# Decision records

One record per significant decision: the situation, the options considered, the choice and why. Records
0001 to 0006 and 0008 were first made for the engine's first host and are ported here so they stand alone;
each says which record it came from. A changed decision gets a new record that supersedes the old one.

| Record | Decision |
|---|---|
| [0001](0001-queries-run-in-postgis-under-a-narrow-read-only-role.md) | Plans compile to PostGIS SQL and run on the server under a narrow read-only role |
| [0002](0002-fields-come-from-the-host-field-definitions.md) | Fields come from the host's field definitions, never from what the data holds |
| [0003](0003-plan-format-with-cql2-json-filters.md) | The plan is versioned JSON; filters use a subset of CQL2-JSON |
| [0004](0004-reference-layers-in-two-generic-postgis-tables.md) | Reference layers live in one layer catalogue and one feature table, loaded as data |
| [0005](0005-spatial-membership-and-distance-rules.md) | Buildings are placed by a point on their footprint; distances are geodesic metres from the edge |
| [0006](0006-engine-is-a-separate-instance-neutral-service.md) | The engine is a separate, instance-neutral service in its own public repository |
| [0007](0007-engine-schema-role-and-migrations.md) | The engine's schema, group role and migrations, and a start-up check that fails closed |
| [0008](0008-log-errors-without-personal-data.md) | Log errors without what people sent or who they are |
