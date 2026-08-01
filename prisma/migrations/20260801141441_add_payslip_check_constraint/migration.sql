-- This is an empty migration.
ALTER TABLE "payslips" ADD CONSTRAINT "chk_net_lte_gross" CHECK ("net_pay_minor_units" <= "gross_pay_minor_units");
