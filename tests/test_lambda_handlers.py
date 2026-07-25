import unittest
from unittest.mock import MagicMock, patch

from api.start import handler as start_handler
from api.status import handler as status_handler
from api.stop import handler as stop_handler


class LambdaHandlerTests(unittest.TestCase):
    @patch("api.start._build_dns_provider")
    @patch("api.start._build_compute_provider")
    @patch("api.start._load_config")
    def test_start_handler_uses_provider_interfaces(self, mock_load_config: MagicMock, mock_build_compute: MagicMock, mock_build_dns: MagicMock) -> None:
        mock_load_config.return_value = {"cf_subdomain": "inference.example.com"}
        mock_compute = MagicMock()
        mock_compute.launch_instance.return_value = "i-123"
        mock_compute.get_ip.return_value = "1.2.3.4"
        mock_build_compute.return_value = mock_compute
        mock_dns = MagicMock()
        mock_dns.create_record.return_value = "record-123"
        mock_build_dns.return_value = mock_dns

        response = start_handler({}, None)

        self.assertEqual(response["statusCode"], 200)
        mock_compute.launch_instance.assert_called_once()
        mock_compute.get_ip.assert_called_once_with("i-123")
        mock_dns.create_record.assert_called_once_with("inference.example.com", "1.2.3.4")

    @patch("api.status._build_compute_provider")
    @patch("api.status._load_config")
    def test_status_handler_returns_state_and_ip(self, mock_load_config: MagicMock, mock_build_compute: MagicMock) -> None:
        mock_load_config.return_value = {}
        mock_compute = MagicMock()
        mock_compute.get_state.return_value = "running"
        mock_compute.get_ip.return_value = "1.2.3.4"
        mock_build_compute.return_value = mock_compute

        response = status_handler({}, None)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["body"], '{"state": "running", "ip": "1.2.3.4"}')

    @patch("api.stop._build_dns_provider")
    @patch("api.stop._build_compute_provider")
    @patch("api.stop._load_config")
    def test_stop_handler_calls_delete_and_terminate(self, mock_load_config: MagicMock, mock_build_compute: MagicMock, mock_build_dns: MagicMock) -> None:
        mock_load_config.return_value = {"cf_subdomain": "inference.example.com"}
        mock_compute = MagicMock()
        mock_build_compute.return_value = mock_compute
        mock_dns = MagicMock()
        mock_build_dns.return_value = mock_dns

        response = stop_handler({}, None)

        self.assertEqual(response["statusCode"], 200)
        mock_dns.delete_record.assert_called_once_with("inference.example.com")
        mock_compute.terminate_instance.assert_called_once_with("")


if __name__ == "__main__":
    unittest.main()
