# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "marimo",
#     "pandas",
#     "matplotlib",
# ]
# ///

import marimo

__generated_with = "0.23.11"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import pandas as pd
    from pathlib import Path

    return Path, mo, pd


@app.cell
def _(mo):
    is_script_mode = mo.app_meta().mode == "script"
    return (is_script_mode,)


@app.cell
def _(mo):
    mo.md(r"""
    # Intern audit: influenza shot offering in a PCP office

    This is a **synthetic, PHI-free 100-person dataset**. The question is whether influenza shots were offered equitably during PCP office visits.

    Outcome: `influenza_shot_offered`

    - `1` means the visit record says a flu shot was offered.
    - `0` means the offer was not documented.
    - This audit does not measure patient acceptance.
    """)
    return


@app.cell
def _(mo):
    mo.md(r"""
    ## Compound Engineering workflow

    Use this notebook like an intern would use the CE plugin:

    1. **Plan:** define the denominator, outcome, groups, and flag rule before looking at results.
    2. **Work:** run the reusable code cells that calculate offer rates and gaps.
    3. **Review:** check PHI safety, denominator logic, small-cell caveats, and whether the interpretation overclaims.

    Suggested CE prompts for a real intern:

    - `/ce-brainstorm Frame a safe disparity audit for influenza shot offering in a PCP office.`
    - `/ce-plan Plan the analysis steps, denominator, subgroup table, and review checks.`
    - `/ce-code-review Review this notebook for data-fidelity, privacy, and interpretation risks.`
    """)
    return


@app.cell
def _(mo):
    mo.md("""
    ## Plan before coding

    - Denominator: each row is one synthetic PCP visit.
    - Outcome: documented offer of an influenza shot during that visit.
    - Main groups: race/ethnicity, insurance, language preference, SVI level, age group, and visit type.
    - Flag rule: review groups with at least 5 visits that are 10 or more percentage points below the benchmark.
    - Benchmark rule: use the highest offer rate among groups with at least 10 visits when possible; otherwise use the highest group in that dimension.
    - Interpretation limit: describe patterns and possible workflow gaps, not causal effects.
    """)
    return


@app.cell
def _(Path):
    notebook_dir = Path(__file__).resolve().parent
    candidate_paths = [
        notebook_dir.parent / "data" / "synthetic" / "influenza_pcp_offer_100.csv",
        notebook_dir / "influenza_pcp_offer_100.csv",
        Path("data") / "synthetic" / "influenza_pcp_offer_100.csv",
    ]
    DATA_PATH = next((_path for _path in candidate_paths if _path.exists()), None)
    return (DATA_PATH,)


@app.cell
def _(DATA_PATH, pd):
    def make_synthetic_influenza_offer_dataset():
        race_groups = [
            "Asian",
            "Black",
            "Latino",
            "White",
            "Multiracial",
        ]
        insurance_types = ["Commercial", "Medicaid", "Medicare", "Uninsured"]
        language_preferences = ["English", "Spanish", "Other"]
        svi_levels = ["Low", "Moderate", "High"]
        age_groups = ["18-39", "40-64", "65+"]
        visit_types = ["Annual", "Follow-up", "Same-day"]
        rows = []

        for index in range(100):
            race_ethnicity = race_groups[index % len(race_groups)]
            insurance_type = insurance_types[(index // 2) % len(insurance_types)]
            language_preference = language_preferences[(index // 3) % len(language_preferences)]
            svi_level = svi_levels[(index // 4) % len(svi_levels)]
            age_group = age_groups[(index // 5) % len(age_groups)]
            visit_type = visit_types[(index // 7) % len(visit_types)]
            score = 82

            if race_ethnicity in {"Black", "Latino"}:
                score -= 10
            if insurance_type in {"Medicaid", "Uninsured"}:
                score -= 9
            if language_preference != "English":
                score -= 8
            if svi_level == "High":
                score -= 11
            if visit_type == "Same-day":
                score -= 7
            if age_group == "65+":
                score += 6

            influenza_shot_offered = 1 if ((index * 37 + 19) % 100) < score else 0
            rows.append(
                {
                    "patient_id": f"SYN-{index + 1:03d}",
                    "race_ethnicity": race_ethnicity,
                    "insurance_type": insurance_type,
                    "language_preference": language_preference,
                    "svi_level": svi_level,
                    "age_group": age_group,
                    "visit_type": visit_type,
                    "influenza_shot_offered": influenza_shot_offered,
                }
            )

        return pd.DataFrame(rows)

    if DATA_PATH is None:
        df = make_synthetic_influenza_offer_dataset()
    else:
        df = pd.read_csv(DATA_PATH)

    df["influenza_shot_offered"] = df["influenza_shot_offered"].astype(int)
    return (df,)


@app.cell
def _(DATA_PATH, df, mo):
    data_source = "built-in deterministic synthetic fallback" if DATA_PATH is None else f"`{DATA_PATH}`"
    mo.md(
        "## 1. Load and basic quality checks\n\n"
        f"Loaded {data_source}.\n\n"
        f"- Rows: **{len(df):,}**\n"
        f"- Columns: **{df.shape[1]}**\n"
        f"- Missing values: **{int(df.isna().sum().sum())}**\n"
        f"- Duplicate synthetic IDs: **{int(df['patient_id'].duplicated().sum())}**"
    )
    return


@app.cell
def _(df):
    df.head(10)
    return


@app.cell
def _(df, mo):
    overall_rate = df["influenza_shot_offered"].mean()
    offered_count = int(df["influenza_shot_offered"].sum())
    not_offered_count = int((1 - df["influenza_shot_offered"]).sum())

    mo.md(
        "## 2. Overall offer rate\n\n"
        f"The PCP office offered influenza shots to **{offered_count} of {len(df)}** "
        f"synthetic visits (**{overall_rate:.1%}**). The offer was not documented for "
        f"**{not_offered_count}** visits."
    )
    return (overall_rate,)


@app.function
def summarize_by(data, dimension, min_benchmark_n=10, min_flag_n=5):
    grouped = (
        data.groupby(dimension, dropna=False)["influenza_shot_offered"]
        .agg(n="size", offered="sum", offer_rate="mean")
        .reset_index()
        .rename(columns={dimension: "group"})
    )
    grouped["not_offered"] = grouped["n"] - grouped["offered"]
    grouped["offer_rate_pct"] = (grouped["offer_rate"] * 100).round(1)
    benchmark_pool = grouped[grouped["n"] >= min_benchmark_n]
    benchmark = benchmark_pool["offer_rate"].max() if not benchmark_pool.empty else grouped["offer_rate"].max()
    grouped["benchmark_offer_rate_pct"] = round(benchmark * 100, 1)
    grouped["gap_vs_benchmark_pct"] = ((grouped["offer_rate"] - benchmark) * 100).round(1)
    grouped["dimension"] = dimension
    grouped["flag"] = grouped.apply(
        lambda _row: "Review" if _row["n"] >= min_flag_n and _row["gap_vs_benchmark_pct"] <= -10 else "",
        axis=1,
    )
    return grouped[
        [
            "dimension",
            "group",
            "n",
            "offered",
            "not_offered",
            "offer_rate_pct",
            "benchmark_offer_rate_pct",
            "gap_vs_benchmark_pct",
            "flag",
        ]
    ].sort_values(["gap_vs_benchmark_pct", "group"])


@app.cell
def _(df, pd):
    audit_dimensions = [
        "race_ethnicity",
        "insurance_type",
        "language_preference",
        "svi_level",
        "age_group",
        "visit_type",
    ]
    subgroup_audit = pd.concat([summarize_by(df, _dimension) for _dimension in audit_dimensions], ignore_index=True)
    flagged_groups = subgroup_audit[subgroup_audit["flag"] == "Review"].copy()
    return flagged_groups, subgroup_audit


@app.cell
def _(mo, subgroup_audit):
    mo.md(
        "## 3. Subgroup audit table\n\n"
        "`gap_vs_benchmark_pct` compares each group with the dimension benchmark. "
        "The benchmark is the highest offer-rate group with at least 10 visits when possible. "
        "A group is flagged when it has at least 5 visits and is 10 percentage points or more below that benchmark."
    )
    subgroup_audit
    return


@app.cell
def _(flagged_groups, mo):
    mo.md("## 4. Groups flagged for review")
    flagged_groups
    return


@app.cell
def _(df, pd):
    cross_tab = pd.crosstab(
        [df["race_ethnicity"], df["insurance_type"]],
        df["influenza_shot_offered"],
        margins=False,
    ).rename(columns={0: "not_offered", 1: "offered"})
    cross_tab["n"] = cross_tab.sum(axis=1)
    cross_tab["offer_rate_pct"] = (cross_tab["offered"] / cross_tab["n"] * 100).round(1)
    cross_tab = cross_tab.reset_index().sort_values(["offer_rate_pct", "race_ethnicity", "insurance_type"])
    return (cross_tab,)


@app.cell
def _(cross_tab, mo):
    mo.md(
        "## 5. Race/ethnicity by insurance cross-check\n\n"
        "This cross-check helps identify whether a disparity may be concentrated "
        "inside smaller combinations of race/ethnicity and insurance type. Because "
        "this synthetic dataset has only 100 rows, use this as a cue for review, not "
        "a formal statistical test."
    )
    cross_tab
    return


@app.cell
def _(flagged_groups, mo, overall_rate):
    lowest_flags = flagged_groups.sort_values("offer_rate_pct").head(6)
    lowest_text = "\n".join(
        [
            f"- {row.dimension}: {row.group} had {row.offer_rate_pct:.1f}% offered "
            f"(n={int(row.n)}, benchmark {row.benchmark_offer_rate_pct:.1f}%, gap {row.gap_vs_benchmark_pct:.1f} percentage points)."
            for row in lowest_flags.itertuples(index=False)
        ]
    )
    mo.md(
        "## 6. Intern interpretation\n\n"
        f"Overall offer rate: **{overall_rate:.1%}**.\n\n"
        "Largest synthetic disparity signals:\n\n"
        f"{lowest_text}\n\n"
        "Suggested next QA steps:\n\n"
        "- Review rooming and reminder workflows for language preference, insurance, "
        "and high-SVI visit groups.\n"
        "- Confirm whether non-offers represent true missed offers or documentation gaps.\n"
        "- Avoid causal language: this is a small synthetic dataset designed for training."
    )
    return


@app.cell
def _(df, flagged_groups, mo):
    review_checks = {
        "row_count_is_100": len(df) == 100,
        "no_missing_values": int(df.isna().sum().sum()) == 0,
        "no_duplicate_synthetic_ids": int(df["patient_id"].duplicated().sum()) == 0,
        "no_direct_identifier_columns": not any(
            _column.lower() in {"name", "mrn", "date_of_birth", "dob", "address", "phone", "email"}
            for _column in df.columns
        ),
        "has_review_flags": len(flagged_groups) > 0,
    }
    review_text = "\n".join(
        [f"- {'PASS' if _passed else 'REVIEW'}: {_name.replace('_', ' ')}" for _name, _passed in review_checks.items()]
    )
    mo.md(
        "## 7. Code review and data-fidelity checklist\n\n"
        f"{review_text}\n\n"
        "Reviewer note: the notebook is safe for training because the dataset is synthetic, "
        "contains no direct identifiers, reports only aggregate subgroup summaries, and explicitly labels the analysis as non-causal."
    )
    return


@app.cell
def _(df):
    chart_data = (
        df.groupby("race_ethnicity")["influenza_shot_offered"]
        .mean()
        .mul(100)
        .sort_values()
        .reset_index(name="offer_rate_pct")
    )
    return (chart_data,)


@app.cell
def _(chart_data, mo, pd):
    _ = pd  # keep dependency explicit for marimo's graph
    try:
        import matplotlib.pyplot as plt
    except ImportError as _error:
        raise RuntimeError("Install matplotlib to render the chart.") from _error

    fig, ax = plt.subplots(figsize=(7, 4))
    ax.barh(chart_data["race_ethnicity"], chart_data["offer_rate_pct"], color="#0f766e")
    ax.set_xlim(0, 100)
    ax.set_xlabel("Influenza shot offered, %")
    ax.set_ylabel("")
    ax.set_title("Influenza Shot Offer Rate by Race/Ethnicity", fontweight="bold")
    ax.grid(axis="x", alpha=0.25)
    for _idx, _row in chart_data.iterrows():
        ax.text(_row["offer_rate_pct"] + 1, _idx, f"{_row['offer_rate_pct']:.1f}%", va="center", fontsize=8)
    fig.tight_layout()
    mo.vstack([mo.md("## 8. Quick visual check"), fig])
    return


@app.cell
def _(flagged_groups, is_script_mode):
    if is_script_mode:
        print("Synthetic influenza offer disparity audit complete.")
        print(
            flagged_groups[
                ["dimension", "group", "n", "offer_rate_pct", "benchmark_offer_rate_pct", "gap_vs_benchmark_pct"]
            ].to_string(index=False)
        )
    return


if __name__ == "__main__":
    app.run()
