import unittest
from unittest.mock import MagicMock, patch

from api.dns.cloudflare import CloudflareDNSProvider


class CloudflareDNSProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.provider = CloudflareDNSProvider(api_token="token", zone_id="zone")

    @patch("api.dns.cloudflare.requests.post")
    def test_create_record_posts_expected_payload(self, mock_post: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {"result": {"id": "record-123"}}
        mock_post.return_value = mock_response

        record_id = self.provider.create_record("inference.example.com", "1.2.3.4")

        self.assertEqual(record_id, "record-123")
        mock_post.assert_called_once()
        self.assertEqual(mock_post.call_args.kwargs["json"]["name"], "inference.example.com")
        self.assertEqual(mock_post.call_args.kwargs["json"]["content"], "1.2.3.4")

    @patch("api.dns.cloudflare.requests.get")
    @patch("api.dns.cloudflare.requests.delete")
    def test_delete_record_looks_up_by_name_when_reference_is_name(self, mock_delete: MagicMock, mock_get: MagicMock) -> None:
        mock_get_response = MagicMock()
        mock_get_response.raise_for_status.return_value = None
        mock_get_response.json.return_value = {"result": [{"id": "record-456"}]}
        mock_get.return_value = mock_get_response

        mock_delete_response = MagicMock()
        mock_delete_response.raise_for_status.return_value = None
        mock_delete.return_value = mock_delete_response

        self.provider.delete_record("inference.example.com")

        mock_get.assert_called_once()
        mock_delete.assert_called_once()
        self.assertIn("dns_records?name=inference.example.com", mock_get.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
