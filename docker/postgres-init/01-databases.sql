-- Runs once, when the local volume is created. agenda_dev comes from POSTGRES_DB.
-- Test databases must end in _test: the test setup refuses anything else.
CREATE DATABASE agenda_test;
CREATE DATABASE agenda_e2e_test;
