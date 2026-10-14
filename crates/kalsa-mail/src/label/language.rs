//! The language the listed mails are written in, by majority: each mail votes for the
//! language whose marker words it contains more of. A tie goes to Italian, the
//! language of the mailbox this was built for.

use crate::mail::ParsedMail;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Language {
    Italian,
    English,
}

const ITALIAN: &[&str] = &[
    "il", "che", "di", "per", "non", "sono", "della", "anche", "grazie", "gentile", "buongiorno", "ciao", "questo",
];
const ENGLISH: &[&str] = &[
    "the", "and", "you", "for", "with", "thanks", "hello", "please", "this", "are", "that", "have",
];

pub fn of<'a>(mails: impl IntoIterator<Item = &'a ParsedMail>) -> Language {
    let (mut italian, mut english) = (0usize, 0usize);
    for mail in mails {
        if votes_english(mail) {
            english += 1;
        } else {
            italian += 1;
        }
    }
    if english > italian {
        Language::English
    } else {
        Language::Italian
    }
}

fn votes_english(mail: &ParsedMail) -> bool {
    let mut italian = 0usize;
    let mut english = 0usize;
    for word in mail.text.split(|c: char| !c.is_alphabetic()) {
        if ITALIAN.iter().any(|marker| word.eq_ignore_ascii_case(marker)) {
            italian += 1;
        } else if ENGLISH.iter().any(|marker| word.eq_ignore_ascii_case(marker)) {
            english += 1;
        }
    }
    english > italian
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mail(text: &str) -> ParsedMail {
        crate::mail::parse(format!("From: a@example.it\r\nSubject: s\r\n\r\n{text}").as_bytes())
    }

    #[test]
    fn a_mail_in_english_votes_english_and_one_in_italian_votes_italian() {
        assert!(votes_english(&mail("Thanks, can you send it? The file is attached and I have the rest.")));
        assert!(!votes_english(&mail("Grazie, puoi mandarmi il file? Non è urgente, sono a casa.")));
    }

    #[test]
    fn the_majority_of_the_listed_mails_decides_and_a_tie_is_italian() {
        let english = [mail("the file and you"), mail("please confirm this"), mail("ciao")];
        assert_eq!(of(&english), Language::English);
        let tied = [mail("the file"), mail("il file")];
        assert_eq!(of(&tied), Language::Italian);
        assert_eq!(of(std::iter::empty()), Language::Italian);
    }
}
