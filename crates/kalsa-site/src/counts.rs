//! A count the Worker recomputes when an engine is removed: the scope it counts, and both grammatical forms.

use crate::html::escape;

/// The Worker reads `data-count` to know what to count and `data-one`/`data-many` to say it, so the
/// wording stays here and the two paths cannot drift apart.
pub fn phrase(scope: &str, count: usize, one: &str, many: &str) -> String {
    let text = if count == 1 { one } else { many }.replace("{n}", &count.to_string());
    format!(
        "<span data-count=\"{}\" data-one=\"{}\" data-many=\"{}\">{}</span>",
        escape(scope),
        escape(one),
        escape(many),
        escape(&text)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_and_many_are_both_carried_and_the_number_is_filled_in() {
        let many = phrase("all", 60, "{n} engine", "{n} engines");
        assert!(many.contains("data-count=\"all\"") && many.contains(">60 engines</span>"));
        assert!(many.contains("data-one=\"{n} engine\"") && many.contains("data-many=\"{n} engines\""));
        assert!(phrase("all", 1, "{n} engine", "{n} engines").contains(">1 engine</span>"));
        assert!(phrase("all", 0, "{n} engine", "{n} engines").contains(">0 engines</span>"));
    }
}
