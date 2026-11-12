"""
Domain rank from Open PageRank (a public link-based score from 0 to 10).

This is the one outside data source the Website tools use. It needs a free key
in OPEN_PAGERANK_KEY; without one the tool stays switched off. The numbers are
passed on exactly as received. Nothing is estimated or adjusted here.
"""
import requests

ENDPOINT = "https://openpagerank.keywordseverywhere.com/v1/domains/bulk"


class DomainRankError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def get_domain_rank(domain: str, key: str) -> dict:
    """``domain`` must already be cleaned with domain_age.clean_domain()."""
    try:
        resp = requests.post(ENDPOINT, json={"domains": [domain], "include_history": False},
                             headers={"Authorization": f"Bearer {key}"}, timeout=10, allow_redirects=False)
    except requests.RequestException:
        raise DomainRankError("lookup_failed", "The rank service did not answer. Please try again later.")
    if resp.status_code == 429:
        raise DomainRankError("busy", "The rank service is busy. Please try again later.")
    if resp.status_code != 200:
        # 401 / 403 here mean the key is wrong or tied to another network address.
        raise DomainRankError("lookup_failed", "The rank service is not available right now.")
    try:
        body = resp.json()
        row = (body.get("results") or [None])[0]
    except (ValueError, AttributeError):
        raise DomainRankError("lookup_failed", "The rank service sent an unreadable answer.")
    if not row or not row.get("found") or row.get("open_page_rank") is None:
        raise DomainRankError("not_found", f"No rank data is published for {domain}.")
    return {
        "domain": str(row.get("domain") or domain)[:253],
        "rank_score": row.get("open_page_rank"),          # 0 to 10
        "global_position": row.get("rank"),
        "referring_domains": row.get("referring_domains"),
        "data_date": body.get("as_of"),
        "source": "Open PageRank",
    }
