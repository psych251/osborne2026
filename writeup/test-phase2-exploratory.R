# TEST of the new Phase 2 exploratory code, using FAKE data (not real participants).
# What it does: (1) builds a fake dataset with the same column names as the report,
# (2) copies the real chunk "phase2-exploratory" out of replication-report.qmd,
# (3) runs that chunk on the fake data. If it runs without errors, the code works.

library(tidyverse)   # data wrangling (dplyr, tidyr, stringr, purrr, readr)
library(psych)       # for alpha(), used inside the chunk

setwd("/Users/andrea/Documents/Repositories/osborne2026/writeup")
set.seed(251)                                   # makes the random numbers repeatable

# ---- 1. Fake data -------------------------------------------------------------
n <- 200                                        # 100 people per condition
cond <- rep(c("normal", "distress"), each = n / 2)
k2 <- tibble(
  participant_id = paste0("p", 1:n),
  condition = factor(cond, levels = c("normal", "distress")),
  # symptom severity is stored 0-4 (distress group tends higher)
  symptom_severity = ifelse(cond == "distress", sample(0:4, n, TRUE, prob = c(.05, .1, .2, .35, .3)),
                                                sample(0:4, n, TRUE, prob = c(.2, .3, .25, .15, .1)))
)
mindset_items <- c("mindset_opportunity", "mindset_decline", "mindset_important",
                   "mindset_enjoyable", "mindset_nothing_to_look_forward", "mindset_manageable")
for (it in mindset_items) {
  neg <- it %in% c("mindset_decline", "mindset_nothing_to_look_forward")   # negatively worded items
  mu <- if (neg) ifelse(cond == "distress", 4, 3) else ifelse(cond == "distress", 3, 4)
  k2[[it]] <- pmin(6, pmax(1, round(rnorm(n, mu, 1))))                        # values 1-6
}
k2 <- k2 |> mutate(mindset_score = (mindset_opportunity + (7 - mindset_decline) + mindset_important +
                                    mindset_enjoyable + (7 - mindset_nothing_to_look_forward) +
                                    mindset_manageable) / 6)

# Fake words: messy on purpose (capitals, spaces) to test the cleaning step.
neg_w <- c("Pain", "angry ", "sad", "tired", "Bad", "Worry", "anxious", "hot flashes", "Aging")
pos_w <- c("freedom", "Good", "calm", "love", "free ", "Happy", "change", "wisdom", "hot flashes")
pick_word <- function(is_distress) sample(c(neg_w, pos_w), 1,
  prob = if (is_distress) c(rep(3, 9), rep(1, 9)) else c(rep(1, 9), rep(3, 9)))
words <- tibble(participant_id = k2$participant_id,
                word_1 = map_chr(cond == "distress", pick_word),
                word_2 = map_chr(cond == "distress", pick_word),
                word_3 = map_chr(cond == "distress", pick_word))

# Stand-ins for objects the report creates itself:
phase2 <- list(trials = tibble(participant_id = k2$participant_id))
parse_task <- function(trials, task) words |> filter(participant_id %in% trials$participant_id)

# ---- 2. Copy the real chunk out of the qmd ------------------------------------------
lines <- readLines("replication-report.qmd", encoding = "UTF-8")
start <- grep("#| label: phase2-exploratory", lines, fixed = TRUE)
end   <- start + which(lines[(start + 1):length(lines)] == "```")[1]
code  <- lines[(start + 1):(end - 1)]
code  <- code[!startsWith(code, "#|")]          # drop the chunk options
tmp <- tempfile(fileext = ".R"); writeLines(code, tmp)

# ---- 3. Run it ------------------------------------------------------------------------
source(tmp, echo = FALSE, print.eval = TRUE)
cat("\nDONE: the chunk ran without errors.\n")
