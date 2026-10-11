import sys
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

API_DIR = Path(__file__).resolve().parent.parent / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from api.authorizer import handler as authorizer_handler
from api.start import handler as start_handler
from api.status import handler as status_handler
from api.stop import handler as stop_handler


class LambdaHandlerTests(unittest.TestCase):
    @patch("api.start._build_compute_provider")
    @patch("api.start._load_config")
    def test_start_handler_uses_provider_interfaces(self, mock_load_config: MagicMock, mock_build_compute: MagicMock) -> None:
        mock_load_config.return_value = {}
        mock_compute = MagicMock()
        mock_compute.launch_instance.return_value = "i-123"
        mock_build_compute.return_value = mock_compute

        response = start_handler({}, None)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["body"], '{"instance_id": "i-123"}')
        mock_compute.launch_instance.assert_called_once()

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

    @patch("api.stop._build_compute_provider")
    @patch("api.stop._load_config")
    def test_stop_handler_calls_terminate(self, mock_load_config: MagicMock, mock_build_compute: MagicMock) -> None:
        mock_load_config.return_value = {}
        mock_compute = MagicMock()
        mock_build_compute.return_value = mock_compute

        response = stop_handler({}, None)

        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(response["body"], '{"stopped": true}')
        mock_compute.terminate_instance.assert_called_once_with("")

    @patch("api.authorizer._get_parameter")
    def test_authorizer_returns_simple_response_for_valid_credentials(self, mock_get_parameter: MagicMock) -> None:
        mock_get_parameter.side_effect = ["demo_user", "demo_pass"]

        response = authorizer_handler({"headers": {"Authorization": "Basic ZGVtb191c2VyOmRlbW9fcGFzcw=="}}, None)

        self.assertEqual(response, {"isAuthorized": True})


if __name__ == "__main__":
    unittest.main()
