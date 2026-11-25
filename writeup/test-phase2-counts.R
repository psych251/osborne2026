# TEST of the new Phase 2 table "participants at each step, by group", using FAKE data.
# It builds fake objects with the same names the report uses, copies the real chunk
# "phase2-counts" out of replication-report.qmd, and runs it. If a table appears, it works.

library(tidyverse)   # dplyr, tidyr, tibble ...

setwd("/Users/andrea/Documents/Repositories/osborne2026/writeup")
set.seed(251)

# ---- 1. Fake data: 100 people, with a mix of outcomes ---------------------------------
n <- 100
fake <- tibble(
  participant_id = paste0("p", 1:n),
  condition = sample(c("normal", "distress"), n, replace = TRUE),
  screened_out = c(rep(TRUE, 10), rep(FALSE, n - 10)),            # 10 not eligible
  outcome = c(rep("screened", 10), rep("declined", 3),             # 3 declined consent
              rep("dropped", 7), rep("finished", n - 20))          # 7 dropped, 80 finished
)
done <- fake |> filter(outcome == "finished")
phase2 <- list(
  participants = fake |> select(participant_id, condition, screened_out),
  complete     = done |> select(participant_id, condition),
  keep         = done |> slice_head(n = 70) |>
                   mutate(condition = factor(condition, levels = c("normal", "distress"))),
  refused_ids  = fake$participant_id[fake$outcome == "declined"]
)

# ---- 2. Copy the real chunk out of the qmd --------------------------------------------
lines <- readLines("replication-report.qmd", encoding = "UTF-8")
start <- grep("#| label: phase2-counts", lines, fixed = TRUE)
end   <- start + which(lines[(start + 1):length(lines)] == "```")[1]
code  <- lines[(start + 1):(end - 1)]
code  <- code[!startsWith(code, "#|")]
tmp <- tempfile(fileext = ".R"); writeLines(code, tmp)

# ---- 3. Run it ------------------------------------------------------------------------
source(tmp, echo = FALSE, print.eval = TRUE)
cat("\nExpected: Assigned 100, Declined 3, Not eligible 10, Did not finish 7, Finished 80, Included 70.\n")
